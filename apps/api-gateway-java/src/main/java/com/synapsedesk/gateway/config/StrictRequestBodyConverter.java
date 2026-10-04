package com.synapsedesk.gateway.config;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.List;
import org.springframework.boot.http.converter.autoconfigure.ServerHttpMessageConvertersCustomizer;
import org.springframework.core.ResolvableType;
import org.springframework.http.MediaType;
import org.springframework.http.converter.HttpMessageConverters;
import org.springframework.http.converter.json.JacksonJsonHttpMessageConverter;
import org.springframework.stereotype.Component;
import tools.jackson.core.JsonParser;
import tools.jackson.core.JsonToken;
import tools.jackson.databind.DeserializationContext;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.ValueDeserializer;
import tools.jackson.databind.cfg.CoercionAction;
import tools.jackson.databind.cfg.CoercionInputShape;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.module.SimpleModule;
import tools.jackson.databind.type.LogicalType;

/**
 * Reads a request body into one of the gateway's own classes STRICTLY: a key the class
 * does not declare is refused, and so is a number or a boolean where it declares a string.
 * Both are 400s before any peer is asked, as on Node, whose validation pipe forbids
 * unknown properties and type-checks every string field.
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

  private final JsonMapper strict;

  public StrictRequestBodyConverter(JsonMapper json) {
    JsonMapper.Builder builder = json
      .rebuild()
      .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
    // Textual is a String; OtherScalar is what is read FROM one, such as a UUID.
    for (LogicalType stringy : List.of(
      LogicalType.Textual,
      LogicalType.OtherScalar
    )) {
      builder.withCoercionConfig(stringy, config -> {
        config.setCoercion(CoercionInputShape.Integer, CoercionAction.Fail);
        config.setCoercion(CoercionInputShape.Float, CoercionAction.Fail);
        config.setCoercion(CoercionInputShape.Boolean, CoercionAction.Fail);
      });
    }
    this.strict = builder
      .addModule(new SimpleModule().addDeserializer(URI.class, STRING_ONLY_URI))
      .build();
  }

  /**
   * Jackson's own URI reader takes {@code 5} as {@code "5"} and consults no coercion
   * rule, so a URI is read here, from a JSON string and nothing else.
   */
  private static final ValueDeserializer<URI> STRING_ONLY_URI =
    new ValueDeserializer<>() {
      @Override
      public URI deserialize(
        JsonParser parser,
        DeserializationContext context
      ) {
        if (!parser.hasToken(JsonToken.VALUE_STRING)) {
          return (URI) context.handleUnexpectedToken(URI.class, parser);
        }
        String text = parser.getString();
        try {
          return new URI(text);
        } catch (URISyntaxException invalid) {
          return (URI) context.handleWeirdStringValue(
            URI.class,
            text,
            "not a URI"
          );
        }
      }
    };

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
