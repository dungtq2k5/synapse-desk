package com.synapsedesk.gateway.validation;

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
 * {@code class-validator}'s {@code @IsPhoneNumber()} with no region: the value must
 * carry its international calling code ({@code +14155552671}) and be a valid number
 * for it. Node uses {@code libphonenumber-js}; this uses Google's
 * {@code libphonenumber}, which that library is generated from, so the two agree on
 * the numbers either is likely to meet. Any other difference is a metadata release
 * apart; the shared parity table is what shows one.
 *
 * <p>Like the original, a value with leading or trailing whitespace is refused
 * before parsing, and a value that cannot be parsed at all is simply invalid.
 *
 * <p>One difference is reproduced on purpose: Google's library treats a fullwidth plus
 * ({@code U+FF0B}) as the leading plus, and {@code libphonenumber-js} does not, so a
 * value containing one is refused here as it is there.
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
