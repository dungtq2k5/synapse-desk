package com.synapsedesk.gateway.graphql;

import com.synapsedesk.gateway.config.JsIsoFormat;
import graphql.language.StringValue;
import graphql.schema.Coercing;
import graphql.schema.CoercingParseValueException;
import graphql.schema.CoercingSerializeException;
import graphql.schema.GraphQLScalarType;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;

/**
 * `scalar DateTime` — Node's `GraphQLISODateTime`, matched byte for byte by
 * reusing {@link JsIsoFormat}, the same formatter {@code CacheService} uses
 * so the two never drift apart the way a second hand-written one could.
 */
final class DateTimeScalar {

  static final GraphQLScalarType TYPE = GraphQLScalarType.newScalar()
    .name("DateTime")
    .coercing(
      new Coercing<Object, String>() {
        @Override
        public String serialize(Object input) {
          Instant instant = switch (input) {
            case Instant i -> i;
            case OffsetDateTime o -> o.toInstant();
            default -> throw new CoercingSerializeException(
              "Cannot serialize " + input + " as DateTime"
            );
          };

          return JsIsoFormat.PATTERN.format(instant);
        }

        @Override
        public Instant parseValue(Object input) {
          if (!(input instanceof String value)) {
            throw new CoercingParseValueException("DateTime must be a string");
          }

          try {
            return Instant.parse(value);
          } catch (DateTimeParseException cause) {
            throw new CoercingParseValueException(
              "Not a valid DateTime: " + value,
              cause
            );
          }
        }

        @Override
        public Instant parseLiteral(Object input) {
          if (!(input instanceof StringValue value)) {
            throw new CoercingParseValueException(
              "DateTime must be a string literal"
            );
          }

          return parseValue(value.getValue());
        }
      }
    )
    .build();

  private DateTimeScalar() {}
}
