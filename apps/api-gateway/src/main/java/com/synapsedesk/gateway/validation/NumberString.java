package com.synapsedesk.gateway.validation;

import jakarta.validation.Constraint;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import jakarta.validation.Payload;
import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import java.util.regex.Pattern;

/**
 * {@code class-validator}'s {@code @IsNumberString()}: {@code validator.js}'s
 * {@code isNumeric}, which is NOT "only digits": an optional sign, then digits with an
 * optional single decimal point before the last run ({@code ^[+-]?([0-9]*[.])?[0-9]+$}).
 * So {@code 123456}, {@code +5} and {@code 1.5} pass and {@code 12a} and {@code 1.}
 * do not. A bound on the length is a separate constraint.
 */
@Documented
@Constraint(validatedBy = NumberString.Validator.class)
@Target({
  ElementType.FIELD,
  ElementType.METHOD,
  ElementType.PARAMETER,
  ElementType.RECORD_COMPONENT,
})
@Retention(RetentionPolicy.RUNTIME)
public @interface NumberString {
  /** validator.js's {@code isNumeric} expression; also the published {@code pattern}. */
  String REGEX = "^[+-]?([0-9]*[.])?[0-9]+$";

  String message() default "must be a number string";

  Class<?>[] groups() default {};

  Class<? extends Payload>[] payload() default {};

  class Validator implements ConstraintValidator<NumberString, String> {

    private static final Pattern NUMERIC = Pattern.compile(REGEX);

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
      return value == null || accepts(value);
    }

    public static boolean accepts(String value) {
      return NUMERIC.matcher(value).matches();
    }
  }
}
