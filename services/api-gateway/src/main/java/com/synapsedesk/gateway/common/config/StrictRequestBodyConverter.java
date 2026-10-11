package com.synapsedesk.gateway.common.config;

import java.net.URI;
import java.time.temporal.Temporal;
import java.util.List;
import java.util.Map;
import org.springframework.boot.http.converter.autoconfigure.ServerHttpMessageConvertersCustomizer;
import org.springframework.core.ResolvableType;
import org.springframework.http.MediaType;
import org.springframework.http.converter.HttpMessageConverters;
import org.springframework.http.converter.json.JacksonJsonHttpMessageConverter;
import org.springframework.stereotype.Component;
import tools.jackson.core.JsonParser;
import tools.jackson.core.JsonToken;
import tools.jackson.databind.BeanDescription;
import tools.jackson.databind.DeserializationConfig;
import tools.jackson.databind.DeserializationContext;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.ValueDeserializer;
import tools.jackson.databind.cfg.CoercionAction;
import tools.jackson.databind.cfg.CoercionInputShape;
import tools.jackson.databind.deser.ValueDeserializerModifier;
import tools.jackson.databind.deser.std.DelegatingDeserializer;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.module.SimpleModule;
import tools.jackson.databind.type.LogicalType;

/**
 * Reads a request body into one of the gateway's own classes STRICTLY: a key the class
 * does not declare is refused, and so is a value whose JSON type is not the one the
 * field declares. All are 400s before any peer is asked.
 *
 * <p><b>JSON types must match exactly.</b> A string field takes a string, a number
 * field a number (an integer field an integer), a boolean field {@code true} or
 * {@code false}, and a date or a URI a string. Nothing is converted: {@code "5"} is not
 * a number, {@code 1} is not {@code true}, {@code 5.5} is not the integer 5, and
 * {@code 5} is not a date. A conversion is a guess about what the client meant, and a
 * wrong guess is written as data: {@code "false"} read as a boolean is {@code true}.
 *
 * <p><b>Request bodies only, and only the gateway's classes.</b> The application's
 * {@link JsonMapper} stays lenient, because it also reads what other systems send:
 * Resend's payloads, other services' NATS events, the cache. Each of those gains fields
 * without asking, and a strict reader would break on the first one. This converter sits
 * in front of the default and answers {@code canRead} only for a type declared under
 * {@code com.synapsedesk.gateway}, so a GraphQL request, a {@code Map} and a raw
 * {@code String} (the webhook intakes, which verify a signature over the bytes) still
 * reach the default. It never writes: responses keep the default converter.
 *
 * <p>The strict mapper is the application's own mapper rebuilt, so it keeps every other
 * rule ({@link ExplicitNullJsonCustomizer} among them).
 */
@Component
public class StrictRequestBodyConverter
  implements ServerHttpMessageConvertersCustomizer
{

  private static final String OWN_PACKAGE = "com.synapsedesk.gateway.";

  /** For each kind of field, the JSON shapes it refuses. */
  private static final Map<LogicalType, List<CoercionInputShape>> REFUSED =
    Map.of(
      LogicalType.Textual,
      List.of(
        CoercionInputShape.Integer,
        CoercionInputShape.Float,
        CoercionInputShape.Boolean
      ),
      LogicalType.OtherScalar,
      List.of(
        CoercionInputShape.Integer,
        CoercionInputShape.Float,
        CoercionInputShape.Boolean
      ),
      LogicalType.Integer,
      List.of(
        CoercionInputShape.String,
        CoercionInputShape.EmptyString,
        CoercionInputShape.Float,
        CoercionInputShape.Boolean
      ),
      // An integer IS a valid number, so a decimal field refuses only the rest.
      LogicalType.Float,
      List.of(
        CoercionInputShape.String,
        CoercionInputShape.EmptyString,
        CoercionInputShape.Boolean
      ),
      LogicalType.Boolean,
      List.of(
        CoercionInputShape.String,
        CoercionInputShape.EmptyString,
        CoercionInputShape.Integer,
        CoercionInputShape.Float
      )
    );

  private final JsonMapper strict;

  public StrictRequestBodyConverter(JsonMapper json) {
    JsonMapper.Builder builder = json
      .rebuild()
      .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
    REFUSED.forEach((kind, shapes) ->
      builder.withCoercionConfig(kind, config ->
        shapes.forEach(shape -> config.setCoercion(shape, CoercionAction.Fail))
      )
    );
    this.strict = builder
      .addModule(
        new SimpleModule().setDeserializerModifier(STRINGS_ONLY_WHERE_IGNORED)
      )
      .build();
  }

  /**
   * Jackson's readers for a URI and for a date consult no coercion rule: they take
   * {@code 5} as the URI {@code "5"} and as five seconds past 1970. Each is wrapped so
   * that anything but a JSON string is refused; a string still goes to Jackson's own
   * reader, and {@code null} never reaches either.
   */
  private static final ValueDeserializerModifier STRINGS_ONLY_WHERE_IGNORED =
    new ValueDeserializerModifier() {
      @Override
      public ValueDeserializer<?> modifyDeserializer(
        DeserializationConfig config,
        BeanDescription.Supplier description,
        ValueDeserializer<?> deserializer
      ) {
        Class<?> type = description.getBeanClass();

        return type == URI.class || Temporal.class.isAssignableFrom(type)
          ? new StringOnly(deserializer)
          : deserializer;
      }
    };

  /** Jackson's own reader, given only a JSON string. */
  private static final class StringOnly extends DelegatingDeserializer {

    StringOnly(ValueDeserializer<?> delegatee) {
      super(delegatee);
    }

    @Override
    protected ValueDeserializer<?> newDelegatingInstance(
      ValueDeserializer<?> delegatee
    ) {
      return new StringOnly(delegatee);
    }

    @Override
    public Object deserialize(
      JsonParser parser,
      DeserializationContext context
    ) {
      if (!parser.hasToken(JsonToken.VALUE_STRING)) {
        return context.handleUnexpectedToken(handledType(), parser);
      }

      return _delegatee.deserialize(parser, context);
    }
  }

  @Override
  public void customize(HttpMessageConverters.ServerBuilder builder) {
    builder.addCustomConverter(
      new JacksonJsonHttpMessageConverter(strict) {
        @Override
        public boolean canRead(ResolvableType type, MediaType mediaType) {
          return isOwn(type.toClass()) && super.canRead(type, mediaType);
        }

        @Override
        public boolean canRead(Class<?> type, MediaType mediaType) {
          return isOwn(type) && super.canRead(type, mediaType);
        }

        @Override
        public boolean canWrite(
          ResolvableType type,
          Class<?> valueClass,
          MediaType mediaType
        ) {
          return false;
        }

        @Override
        public boolean canWrite(Class<?> type, MediaType mediaType) {
          return false;
        }
      }
    );
  }

  static boolean isOwn(Class<?> type) {
    return type.getName().startsWith(OWN_PACKAGE);
  }
}
