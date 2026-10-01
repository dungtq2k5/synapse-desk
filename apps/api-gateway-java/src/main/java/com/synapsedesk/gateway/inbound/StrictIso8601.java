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
import java.time.DateTimeException;
import java.time.LocalDate;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * {@code class-validator}'s {@code @IsISO8601({ strict: true })}, ported from
 * {@code validator.js} 13.15 — the regex is the library's own, copied from its
 * source rather than rewritten, and {@link Validator#isValidDate} follows its
 * strict check, so {@code 2026-02-30} is refused as well as {@code not a date}.
 *
 * <p>It accepts what the library accepts, which is more than the extended form:
 * a space separator, the basic format ({@code 20260915}), week dates and ordinal
 * dates. The shared table {@code validator-parity.json} holds this to the real
 * function row for row.
 */
@Documented
@Constraint(validatedBy = StrictIso8601.Validator.class)
@Target({
  ElementType.FIELD,
  ElementType.PARAMETER,
  ElementType.RECORD_COMPONENT,
})
@Retention(RetentionPolicy.RUNTIME)
public @interface StrictIso8601 {
  String message() default "must be a valid ISO 8601 date string";

  Class<?>[] groups() default {};

  Class<? extends Payload>[] payload() default {};

  class Validator implements ConstraintValidator<StrictIso8601, String> {

    private static final Pattern ISO_8601 = Pattern.compile(
      "^([\\+-]?\\d{4}(?!\\d{2}\\b))((-?)((0[1-9]|1[0-2])(\\3([12]\\d|0[1-9]|3[01]))?|W([0-4]\\d|5[0-3])(-?[1-7])?|(00[1-9]|0[1-9]\\d|[12]\\d{2}|3([0-5]\\d|6[1-6])))([T\\s]((([01]\\d|2[0-3])((:?)[0-5]\\d)?|24:?00)([\\.,]\\d+(?!:))?)?(\\17[0-5]\\d([\\.,]\\d+)?)?([zZ]|([\\+-])([01]\\d|2[0-3]):?([0-5]\\d)?)?)?)?$"
    );
    private static final Pattern ORDINAL = Pattern.compile(
      "^(\\d{4})-?(\\d{3})([ T]{1}\\.*|$)"
    );
    private static final Pattern DATE_PARTS = Pattern.compile(
      "(\\d{4})-?(\\d{0,2})-?(\\d*)"
    );

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
      return value == null || accepts(value);
    }

    static boolean accepts(String value) {
      return ISO_8601.matcher(value).matches() && isValidDate(value);
    }

    /** Catches the dates the regex cannot, like 2009-02-31. */
    static boolean isValidDate(String value) {
      Matcher ordinal = ORDINAL.matcher(value);
      if (ordinal.find()) {
        long year = Long.parseLong(ordinal.group(1));
        long day = Long.parseLong(ordinal.group(2));
        boolean leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;

        return day <= (leap ? 366 : 365);
      }

      Matcher parts = DATE_PARTS.matcher(value);
      if (!parts.find()) return true;

      int year = Integer.parseInt(parts.group(1));
      int month = parts.group(2).isEmpty()
        ? 0
        : Integer.parseInt(parts.group(2));
      int day = parts.group(3).isEmpty() ? 0 : Integer.parseInt(parts.group(3));

      if (month == 0 || day == 0) return true;

      try {
        LocalDate.of(year, month, day);
        return true;
      } catch (DateTimeException invalid) {
        return false;
      }
    }
  }
}
