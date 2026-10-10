package com.synapsedesk.gateway.error;

import java.time.temporal.Temporal;
import java.util.Arrays;
import java.util.Collection;
import java.util.UUID;
import java.util.stream.Collectors;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.DatabindException;
import tools.jackson.databind.exc.MismatchedInputException;
import tools.jackson.databind.exc.UnrecognizedPropertyException;
import tools.jackson.databind.exc.ValueInstantiationException;

/**
 * The message for a body that parsed as JSON but does not fit the class it is read
 * into, in the caller's terms: the field's path as it appears in the JSON
 * ({@code departments.0.isPrimary}) and the JSON type it must be.
 *
 * <p>Never Jackson's own message: that names Java classes and parser tokens
 * ({@code java.lang.String}, {@code JsonToken.START_OBJECT}).
 *
 * @example {@code property extra should not exist}, {@code password must be a string},
 *     {@code priority must be one of LOW, MEDIUM, HIGH, URGENT}
 */
final class BodyBindingMessage {

  private BodyBindingMessage() {}

  static String of(DatabindException binding) {
    String path = binding
      .getPath()
      .stream()
      .map(BodyBindingMessage::segment)
      .collect(Collectors.joining("."));

    if (binding instanceof UnrecognizedPropertyException) {
      return "property " + path + " should not exist";
    }
    String subject = path.isEmpty() ? "the request body" : path;
    if (
      binding instanceof ValueInstantiationException instantiation &&
      instantiation.getType().isEnumType()
    ) {
      return (
        subject + " must be " + jsonType(instantiation.getType().getRawClass())
      );
    }
    if (
      binding instanceof MismatchedInputException mismatch &&
      mismatch.getTargetType() != null
    ) {
      return subject + " must be " + jsonType(mismatch.getTargetType());
    }

    return subject + " is not valid";
  }

  private static String segment(JacksonException.Reference reference) {
    return reference.getPropertyName() != null
      ? reference.getPropertyName()
      : String.valueOf(reference.getIndex());
  }

  /** The JSON type a Java type is read from, with its article, or an enum's values. */
  static String jsonType(Class<?> type) {
    if (type.isEnum()) {
      // A generated enum prints its JSON value, which may be a number.
      return (
        "one of " +
        Arrays.stream(type.getEnumConstants())
          .map(String::valueOf)
          .collect(Collectors.joining(", "))
      );
    }
    if (
      CharSequence.class.isAssignableFrom(type) ||
      type == UUID.class ||
      type == java.net.URI.class ||
      Temporal.class.isAssignableFrom(type)
    ) {
      return "a string";
    }
    if (
      Number.class.isAssignableFrom(type) ||
      (type.isPrimitive() && type != boolean.class)
    ) {
      return "a number";
    }
    if (type == Boolean.class || type == boolean.class) return "a boolean";
    if (type.isArray() || Collection.class.isAssignableFrom(type)) {
      return "an array";
    }

    return "an object";
  }
}
