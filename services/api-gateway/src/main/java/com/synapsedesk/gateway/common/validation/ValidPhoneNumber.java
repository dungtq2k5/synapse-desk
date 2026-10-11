package com.synapsedesk.gateway.common.validation;

import com.google.i18n.phonenumbers.NumberParseException;
import com.google.i18n.phonenumbers.PhoneNumberUtil;
import jakarta.validation.Constraint;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import jakarta.validation.Payload;
import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * {@code class-validator}'s {@code @IsPhoneNumber()} rule with no region, the rule
 * {@code docs/reference/openapi.json} publishes: the value must carry its
 * international calling code ({@code +14155552671}) and be a valid number for it, as
 * Google's {@code libphonenumber} judges it. The parity table
 * ({@code test/fixtures/inbound-email/validator-parity.json}) holds the cases.
 *
 * <p>A value with leading or trailing whitespace is refused before parsing, and a
 * value that cannot be parsed at all is simply invalid.
 *
 * <p>A fullwidth plus ({@code U+FF0B}) is refused, although Google's library would
 * read it as the leading plus: nothing normalises a phone number to E.164 before it
 * is stored, so a fullwidth plus would be stored as a different number from the same
 * digits behind an ASCII plus.
 */
@Documented
@Constraint(validatedBy = ValidPhoneNumber.Validator.class)
@Target({
  ElementType.FIELD,
  ElementType.METHOD,
  ElementType.PARAMETER,
  ElementType.RECORD_COMPONENT,
})
@Retention(RetentionPolicy.RUNTIME)
public @interface ValidPhoneNumber {
  String message() default "must be a valid phone number";

  Class<?>[] groups() default {};

  Class<? extends Payload>[] payload() default {};

  class Validator implements ConstraintValidator<ValidPhoneNumber, String> {

    private static final PhoneNumberUtil PHONES = PhoneNumberUtil.getInstance();
    private static final char FULLWIDTH_PLUS = '\uFF0B';

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
      return value == null || accepts(value);
    }

    public static boolean accepts(String value) {
      if (!value.strip().equals(value)) return false;
      if (value.indexOf(FULLWIDTH_PLUS) >= 0) return false;
      try {
        return PHONES.isValidNumber(PHONES.parse(value, null));
      } catch (NumberParseException unparseable) {
        return false;
      }
    }
  }
}
