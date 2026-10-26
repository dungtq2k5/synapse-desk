package com.synapsedesk.gateway.common.validation;

import jakarta.validation.Constraint;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import jakarta.validation.Payload;
import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;

/**
 * A calendar day, {@code YYYY-MM-DD}, that exists: {@code 2026-02-30}, a
 * timestamp and the basic form are refused. Published as the {@link #REGEX}
 * pattern ({@code ConstraintPublishingCustomizer}); the date's existence has no
 * keyword. {@code null} is valid; {@code @NotNull} says otherwise.
 *
 * <pre>
 * "2026-01-31" valid · "2026-02-30" invalid · "2026-01-31T00:00:00Z" invalid
 * </pre>
 */
@Documented
@Constraint(validatedBy = CalendarDate.Validator.class)
@Target({
  ElementType.FIELD,
  ElementType.METHOD,
  ElementType.PARAMETER,
  ElementType.RECORD_COMPONENT,
})
@Retention(RetentionPolicy.RUNTIME)
public @interface CalendarDate {
  String REGEX = "^\\d{4}-\\d{2}-\\d{2}$";

  String message() default "must be a date (YYYY-MM-DD)";

  Class<?>[] groups() default {};

  Class<? extends Payload>[] payload() default {};

  class Validator implements ConstraintValidator<CalendarDate, String> {

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
      if (value == null) return true;
      if (!value.matches(REGEX)) return false;
      try {
        LocalDate.parse(value);
        return true;
      } catch (DateTimeParseException notADay) {
        return false;
      }
    }
  }
}
