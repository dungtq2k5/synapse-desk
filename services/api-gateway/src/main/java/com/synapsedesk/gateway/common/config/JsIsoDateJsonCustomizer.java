package com.synapsedesk.gateway.common.config;

import java.time.OffsetDateTime;
import org.springframework.boot.jackson.autoconfigure.JsonMapperBuilderCustomizer;
import org.springframework.stereotype.Component;
import tools.jackson.core.JsonGenerator;
import tools.jackson.databind.SerializationContext;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.module.SimpleModule;
import tools.jackson.databind.ser.std.StdSerializer;

/**
 * Writes every {@link OffsetDateTime} in a response as {@link JsIsoFormat}:
 * {@code 2026-10-19T09:38:54.800Z}, never Jackson's own {@code …54.8Z}.
 *
 * <p>Jackson's default formatter drops trailing zeros from the fraction, and the
 * whole fraction on a whole second. Both still parse, but they don't sort: a client
 * that orders timestamps as strings, as ISO strings of one shape allow, reads
 * {@code …54.8Z} as later than {@code …54.809Z}. One shape for every timestamp keeps
 * that order true.
 */
@Component
public class JsIsoDateJsonCustomizer implements JsonMapperBuilderCustomizer {

  @Override
  public void customize(JsonMapper.Builder builder) {
    builder.addModule(
      new SimpleModule().addSerializer(
        OffsetDateTime.class,
        new StdSerializer<>(OffsetDateTime.class) {
          @Override
          public void serialize(
            OffsetDateTime value,
            JsonGenerator gen,
            SerializationContext ctx
          ) {
            gen.writeString(JsIsoFormat.PATTERN.format(value.toInstant()));
          }
        }
      )
    );
  }
}
