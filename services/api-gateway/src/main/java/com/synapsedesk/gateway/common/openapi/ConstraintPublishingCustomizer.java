package com.synapsedesk.gateway.common.openapi;

import com.synapsedesk.gateway.common.validation.CalendarDate;
import com.synapsedesk.gateway.common.validation.FutureDate;
import com.synapsedesk.gateway.common.validation.Matches;
import com.synapsedesk.gateway.common.validation.NumberString;
import com.synapsedesk.gateway.common.validation.StrictIso8601;
import com.synapsedesk.gateway.common.validation.StrongPassword;
import com.synapsedesk.gateway.common.validation.ValidPhoneNumber;
import io.swagger.v3.core.converter.AnnotatedType;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.parameters.Parameter;
import java.lang.annotation.Annotation;
import org.springdoc.core.customizers.ParameterCustomizer;
import org.springdoc.core.customizers.PropertyCustomizer;
import org.springframework.core.MethodParameter;
import org.springframework.stereotype.Component;

/**
 * Publishes the gateway's own constraints, read from the annotations that enforce
 * them, so each is declared once and the document follows it.
 *
 * <p><b>Where a keyword can say it, the keyword does.</b> {@link Matches},
 * {@link NumberString} and {@link StrongPassword} become the field's {@code pattern},
 * exactly the expression the validator uses (or, for the password, an equivalent one
 * the parity table checks row for row). {@link StrictIso8601} becomes validator.js's own
 * ISO expression: a necessary condition, since a date that does not exist matches it and
 * is refused after; {@code format: date-time} would be FALSE, because the rule also
 * accepts a bare date, the basic form, a week date and an ordinal date.
 *
 * <p><b>Where no keyword can, one sentence does, worded once per rule.</b> A phone
 * number's validity is a property of a numbering plan and a lock date's of the clock,
 * and JSON Schema has neither. Each is a fixed sentence appended to the field's
 * {@code description}, never a {@code format} a tool would silently ignore.
 */
@Component
public class ConstraintPublishingCustomizer
  implements PropertyCustomizer, ParameterCustomizer
{

  static final String PHONE =
    "Must be a valid phone number written with its international calling code, for example +14155552671.";
  static final String FUTURE = "Must be a date in the future.";

  @Override
  @SuppressWarnings("rawtypes")
  public Schema customize(Schema property, AnnotatedType type) {
    if (property != null && type != null && type.getCtxAnnotations() != null) {
      publish(property, type.getCtxAnnotations());
    }

    return property;
  }

  @Override
  public Parameter customize(Parameter parameter, MethodParameter method) {
    if (parameter != null && parameter.getSchema() != null && method != null) {
      publish(parameter.getSchema(), method.getParameterAnnotations());
    }

    return parameter;
  }

  @SuppressWarnings("rawtypes")
  static void publish(Schema schema, Annotation[] annotations) {
    for (Annotation annotation : annotations) {
      if (annotation instanceof Matches matches) {
        schema.setPattern(matches.regex());
      } else if (annotation instanceof CalendarDate) {
        schema.setPattern(CalendarDate.REGEX);
      } else if (annotation instanceof StrictIso8601) {
        schema.setPattern(StrictIso8601.REGEX);
      } else if (annotation instanceof NumberString) {
        schema.setPattern(NumberString.REGEX);
      } else if (annotation instanceof StrongPassword) {
        schema.setPattern(StrongPassword.REGEX);
      } else if (annotation instanceof ValidPhoneNumber) {
        append(schema, PHONE);
      } else if (annotation instanceof FutureDate) {
        append(schema, FUTURE);
      }
    }
  }

  @SuppressWarnings("rawtypes")
  private static void append(Schema schema, String sentence) {
    String current = schema.getDescription();
    if (current != null && current.contains(sentence)) return;
    schema.setDescription(
      current == null || current.isBlank()
        ? sentence
        : current + "\n\n" + sentence
    );
  }
}
