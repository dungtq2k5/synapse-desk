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
import java.time.DateTimeException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Node's {@code @IsFutureDate()}: the value parses as a date ({@code Date.parse}) and
 * is later than now. It answers only that, as in Node, so pair it with
 * {@link StrictIso8601}, which answers "is it a date at all".
 *
 * <p><b>Which strings parse is the part that is ported by measurement.</b>
 * {@code Date.parse} accepts the ECMAScript date-time forms and some more, but not the
 * ISO 8601 week, basic ({@code 29990101}) or hour-only forms that strict ISO 8601
 * allows, so a lock date written that way is refused by Node's {@code @IsFutureDate}
 * though it is a valid ISO date. This accepts the forms below, and the shared parity
 * table holds it to the real decorator on a list of both kinds; a form that table does
 * not hold may differ. One oddity is reproduced on purpose: {@code 2999-001} is not an
 * ordinal date to {@code Date.parse} but a year and a THREE-digit month, so {@code 001}
 * to {@code 012} parse and {@code 013} and {@code 365} do not.
 *
 * <p>A date with no time is UTC, and a date-time with no offset is in the server's own
 * time zone, as in JavaScript.
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

  class Validator implements ConstraintValidator<FutureDate, String> {

    private static final Pattern PARSEABLE = Pattern.compile(
      "^([+-]?\\d{4,6})(?:-(\\d{2})(?:-(\\d{2}))?)?(?:[T ](\\d{2}):(\\d{2})(?::(\\d{2})(?:\\.(\\d+))?)?([zZ]|[+-]\\d{2}:?\\d{2})?)?$"
    );
    private static final Pattern YEAR_AND_THREE_DIGIT_MONTH = Pattern.compile(
      "^(\\d{4})-(\\d{3})$"
    );

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
      return value == null || accepts(value);
    }

    public static boolean accepts(String value) {
      return accepts(value, Instant.now());
    }

    static boolean accepts(String value, Instant now) {
      Instant instant = parse(value);

      return instant != null && instant.isAfter(now);
    }

    /** The instant {@code Date.parse} would give, or null where it would give NaN. */
    static Instant parse(String value) {
      try {
        Matcher legacy = YEAR_AND_THREE_DIGIT_MONTH.matcher(value);
        if (legacy.matches()) {
          int month = Integer.parseInt(legacy.group(2));
          if (month < 1 || month > 12) return null;

          return LocalDate.of(Integer.parseInt(legacy.group(1)), month, 1)
            .atStartOfDay(ZoneId.systemDefault())
            .toInstant();
        }
        Matcher m = PARSEABLE.matcher(value);
        if (!m.matches()) return null;
        LocalDate date = LocalDate.of(
          Integer.parseInt(m.group(1)),
          m.group(2) == null ? 1 : Integer.parseInt(m.group(2)),
          m.group(3) == null ? 1 : Integer.parseInt(m.group(3))
        );
        if (m.group(4) == null) return date
          .atStartOfDay(ZoneOffset.UTC)
          .toInstant();
        int hour = Integer.parseInt(m.group(4));
        LocalDateTime local = date
          .atStartOfDay()
          .plusHours(hour)
          .plusMinutes(Integer.parseInt(m.group(5)))
          .plusSeconds(m.group(6) == null ? 0 : Integer.parseInt(m.group(6)));
        if (m.group(8) == null) return local
          .atZone(ZoneId.systemDefault())
          .toInstant();
        String zone = m.group(8);

        return local
          .atOffset(
            zone.equalsIgnoreCase("z")
              ? ZoneOffset.UTC
              : ZoneOffset.of(
                  zone.length() == 5
                    ? zone.substring(0, 3) + ":" + zone.substring(3)
                    : zone
                )
          )
          .toInstant();
      } catch (DateTimeException | NumberFormatException unparseable) {
        return null;
      }
    }
  }
}
