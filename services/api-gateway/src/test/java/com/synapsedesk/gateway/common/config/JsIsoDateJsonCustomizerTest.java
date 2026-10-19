package com.synapsedesk.gateway.common.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.jackson.autoconfigure.JacksonAutoConfiguration;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import tools.jackson.databind.json.JsonMapper;

/**
 * A timestamp is written with exactly three fractional digits, in UTC, so
 * timestamps sort as strings: {@code .800Z} before {@code .809Z}.
 */
class JsIsoDateJsonCustomizerTest {

  private static JsonMapper mapper() {
    JsonMapper.Builder builder = JsonMapper.builder();
    new JsIsoDateJsonCustomizer().customize(builder);
    return builder.build();
  }

  private static OffsetDateTime at(int nanos, ZoneOffset offset) {
    return OffsetDateTime.of(
      2026,
      10,
      19,
      9,
      38,
      54,
      nanos,
      ZoneOffset.UTC
    ).withOffsetSameInstant(offset);
  }

  @Test
  void writesThreeDigitsInUtcWhateverTheValue() {
    JsonMapper mapper = mapper();

    assertThat(
      mapper.writeValueAsString(at(800_000_000, ZoneOffset.UTC))
    ).isEqualTo("\"2026-10-19T09:38:54.800Z\"");
    assertThat(
      mapper.writeValueAsString(at(0, ZoneOffset.ofHours(7)))
    ).isEqualTo("\"2026-10-19T09:38:54.000Z\"");
    assertThat(
      mapper.writeValueAsString(at(809_123_456, ZoneOffset.UTC))
    ).isEqualTo("\"2026-10-19T09:38:54.809Z\"");
  }

  @Test
  void timestampsSortAsStrings() {
    JsonMapper mapper = mapper();
    String earlier = mapper.writeValueAsString(at(800_000_000, ZoneOffset.UTC));
    String later = mapper.writeValueAsString(at(809_000_000, ZoneOffset.UTC));

    assertThat(earlier).isLessThan(later);
    assertThat(
      mapper.writeValueAsString(List.of(at(0, ZoneOffset.UTC)))
    ).isEqualTo("[\"2026-10-19T09:38:54.000Z\"]");
  }

  @Test
  void bootsMapperWritesTheSameShape() {
    new ApplicationContextRunner()
      .withConfiguration(AutoConfigurations.of(JacksonAutoConfiguration.class))
      .withUserConfiguration(JsIsoDateJsonCustomizer.class)
      .run(context ->
        assertThat(
          context
            .getBean(JsonMapper.class)
            .writeValueAsString(at(800_000_000, ZoneOffset.UTC))
        ).isEqualTo("\"2026-10-19T09:38:54.800Z\"")
      );
  }
}
