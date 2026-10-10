package com.synapsedesk.gateway.inbound;

import jakarta.validation.Constraint;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import jakarta.validation.Payload;
import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.regex.Pattern;

/**
 * {@code class-validator}'s {@code @IsEmail()}, ported from {@code validator.js}
 * 13.15's {@code isEmail} and {@code isFQDN} with their defaults: no display
 * name, UTF-8 local parts allowed, a top-level domain required, no underscores,
 * no IP-literal domains.
 *
 * <p><b>Not Jakarta's {@code @Email}, deliberately.</b> That accepts {@code
 * ada@acme} and {@code a..b@acme.test}, which {@code isEmail} refuses as
 * {@code invalid_payload}.
 *
 * <p><b>Reproduced as written, including its edges</b>: the whole address is
 * capped at 254 characters, the local part at 64 BYTES and the domain at 254
 * bytes (UTF-8, not characters), the domain's labels at 63, and a local part
 * wrapped in double quotes is checked against the quoted-string rule — so a lone
 * {@code "} is accepted, as it is there. The shared table {@code
 * validator-parity.json} holds this to the real function row for row.
 */
@Documented
@Constraint(validatedBy = StrictEmail.Validator.class)
@Target({
  ElementType.FIELD,
  ElementType.PARAMETER,
  ElementType.RECORD_COMPONENT,
})
@Retention(RetentionPolicy.RUNTIME)
public @interface StrictEmail {
  String message() default "must be an email";

  Class<?>[] groups() default {};

  Class<? extends Payload>[] payload() default {};

  class Validator implements ConstraintValidator<StrictEmail, String> {

    private static final int MAX_ADDRESS_LENGTH = 254;
    private static final int MAX_USER_BYTES = 64;
    private static final int MAX_DOMAIN_BYTES = 254;
    private static final int MAX_LABEL_LENGTH = 63;

    /** {@code emailUserUtf8Part}. */
    private static final Pattern USER_PART = Pattern.compile(
      "^[a-z\\d!#$%&'*+\\-/=?^_`{|}~\\u00A1-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFEF]+$",
      Pattern.CASE_INSENSITIVE
    );

    /** {@code quotedEmailUserUtf8}. */
    private static final Pattern QUOTED_USER = Pattern.compile(
      "^([\\s\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f\\x21\\x23-\\x5b\\x5d-\\x7e\\u00A0-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFEF]|(\\\\[\\x01-\\x09\\x0b\\x0c\\x0d-\\x7f\\u00A0-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFEF]))*$",
      Pattern.CASE_INSENSITIVE
    );

    private static final Pattern TLD = Pattern.compile(
      "^([a-z\\u00A1-\\u00A8\\u00AA-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFEF]{2,}|xn[a-z0-9-]{2,})$",
      Pattern.CASE_INSENSITIVE
    );
    private static final Pattern LABEL = Pattern.compile(
      "^[a-z_\\u00a1-\\uffff0-9-]+$",
      Pattern.CASE_INSENSITIVE
    );
    private static final Pattern FULL_WIDTH = Pattern.compile(
      "[\\uff01-\\uff5e]"
    );

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
      return value == null || accepts(value);
    }

    static boolean accepts(String address) {
      if (address.length() > MAX_ADDRESS_LENGTH) return false;

      // `str.split('@')`, then the LAST segment is the domain and the rest, rejoined, the user.
      String[] parts = address.split("@", -1);
      String domain = parts[parts.length - 1];
      String user = String.join("@", Arrays.copyOf(parts, parts.length - 1));

      if (
        utf8Length(user) > MAX_USER_BYTES ||
        utf8Length(domain) > MAX_DOMAIN_BYTES
      ) {
        return false;
      }
      if (!isFqdn(domain)) return false;

      if (
        !user.isEmpty() &&
        user.charAt(0) == '"' &&
        user.charAt(user.length() - 1) == '"'
      ) {
        String quoted =
          user.length() == 1 ? "" : user.substring(1, user.length() - 1);

        return QUOTED_USER.matcher(quoted).matches();
      }

      for (String part : user.split("\\.", -1)) {
        if (!USER_PART.matcher(part).matches()) return false;
      }

      return true;
    }

    private static boolean isFqdn(String domain) {
      String[] parts = domain.split("\\.", -1);
      if (parts.length < 2) return false; // a TLD is required

      String tld = parts[parts.length - 1];
      if (!TLD.matcher(tld).matches()) return false;
      if (
        tld.chars().anyMatch(c -> JsText.isWhitespace((char) c))
      ) return false;

      for (String part : parts) {
        if (part.length() > MAX_LABEL_LENGTH) return false;
        if (!LABEL.matcher(part).matches()) return false;
        if (FULL_WIDTH.matcher(part).find()) return false;
        if (part.startsWith("-") || part.endsWith("-")) return false;
        if (part.indexOf('_') >= 0) return false;
      }

      return true;
    }

    private static int utf8Length(String value) {
      return value.getBytes(StandardCharsets.UTF_8).length;
    }
  }
}
