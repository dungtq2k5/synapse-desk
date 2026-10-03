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
 * {@code class-validator}'s {@code @Matches(pattern)}: the whole value must match
 * {@link #regex()}. A JavaScript pattern is written with {@code ^} and {@code $}, which
 * are kept; matching the whole input is what they mean there too.
 *
 * <p>Not {@code @Pattern}, deliberately: springdoc publishes {@code @Pattern} as the
 * schema's {@code pattern}, and publishing a constraint is a decision of its own. This
 * enforces it and says nothing in the document.
 */
@Documented
@Constraint(validatedBy = Matches.Validator.class)
@Target({
  ElementType.FIELD,
  ElementType.METHOD,
  ElementType.PARAMETER,
  ElementType.RECORD_COMPONENT,
})
@Retention(RetentionPolicy.RUNTIME)
public @interface Matches {
  String message() default "does not match the required pattern";

  Class<?>[] groups() default {};

  Class<? extends Payload>[] payload() default {};

  String regex();

  class Validator implements ConstraintValidator<Matches, String> {

    private Pattern pattern;

    @Override
    public void initialize(Matches annotation) {
      pattern = Pattern.compile(annotation.regex());
    }

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
      return value == null || pattern.matcher(value).matches();
    }
  }
}
