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
import java.time.Instant;
import java.time.OffsetDateTime;

/**
 * A date-time later than now.
 *
 * <p>On an {@link OffsetDateTime} field, so the request body's reader has already
 * required a full date-time with an offset ({@code 2999-01-01T00:00:00Z}) and answered
 * 400 for anything else. A date with no time, or a time with no offset, would leave the
 * gateway guessing which instant was meant, so neither is accepted; this answers only
 * whether the instant is in the future.
 *
 * <p>The document publishes the field as {@code format: date-time}, and this rule as
 * the sentence {@code ConstraintPublishingCustomizer.FUTURE}, since no keyword can say
 * "later than now".
 *
 * @example a lock date of {@code 2999-01-01T00:00:00Z} passes, and of
 *     {@code 2000-01-01T00:00:00Z} answers 400 naming the field
 */
@Documented
@Constraint(validatedBy = FutureDate.Validator.class)
@Target({
  ElementType.FIELD,
  ElementType.METHOD,
  ElementType.PARAMETER,
  ElementType.RECORD_COMPONENT,
})
@Retention(RetentionPolicy.RUNTIME)
public @interface FutureDate {
  String message() default "must be a date in the future";

  Class<?>[] groups() default {};

  Class<? extends Payload>[] payload() default {};

  class Validator implements ConstraintValidator<FutureDate, OffsetDateTime> {

    @Override
    public boolean isValid(
      OffsetDateTime value,
      ConstraintValidatorContext context
    ) {
      return value == null || isAfter(value, Instant.now());
    }

    static boolean isAfter(OffsetDateTime value, Instant now) {
      return value.toInstant().isAfter(now);
    }
  }
}
