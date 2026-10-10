package com.synapsedesk.gateway.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.math.BigDecimal;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.MediaType;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.http.converter.HttpMessageConverters;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.mock.http.MockHttpInputMessage;
import tools.jackson.databind.json.JsonMapper;

/**
 * A request body's JSON types must match the class exactly: nothing is converted.
 *
 * <p>So {@code "false"} is refused for a boolean rather than read as {@code true},
 * and {@code true} for a number rather than read as 1.
 */
class StrictRequestBodyConverterTest {

  /** A request class of the gateway's own: one field of each kind. */
  static class Fields {

    public String text;
    public Integer count;
    public BigDecimal amount;
    public Boolean flag;
    public OffsetDateTime at;
    public URI url;
  }

  @SuppressWarnings("unchecked")
  private static final HttpMessageConverter<Object> STRICT = strict();

  private static HttpMessageConverter<Object> strict() {
    HttpMessageConverters.ServerBuilder builder =
      HttpMessageConverters.forServer();
    new StrictRequestBodyConverter(JsonMapper.builder().build()).customize(
      builder
    );

    // Custom converters come first.
    return (HttpMessageConverter<Object>) builder.build().iterator().next();
  }

  private static Fields read(String json) throws Exception {
    return (Fields) STRICT.read(
      Fields.class,
      new MockHttpInputMessage(json.getBytes(StandardCharsets.UTF_8))
    );
  }

  @Test
  void eachFieldTakesItsOwnJsonType() throws Exception {
    Fields fields = read(
      "{\"text\":\"t\",\"count\":5,\"amount\":5,\"flag\":false," +
        "\"at\":\"2026-01-01T00:00:00Z\",\"url\":\"https://example.com/a\"}"
    );

    assertThat(fields.count).isEqualTo(5);
    assertThat(fields.amount).isEqualByComparingTo("5");
    assertThat(fields.flag).isFalse();
    assertThat(fields.at).isEqualTo("2026-01-01T00:00:00Z");
    assertThat(fields.url).hasToString("https://example.com/a");
  }

  @Test
  void anExplicitNullIsStillNull() throws Exception {
    Fields fields = read("{\"at\":null,\"url\":null,\"flag\":null}");

    assertThat(fields.at).isNull();
    assertThat(fields.url).isNull();
    assertThat(fields.flag).isNull();
  }

  @ParameterizedTest
  @ValueSource(
    strings = {
      "{\"unknown\":1}",
      "{\"text\":5}",
      "{\"text\":true}",
      "{\"count\":\"5\"}",
      "{\"count\":\"\"}",
      "{\"count\":true}",
      "{\"count\":5.5}",
      "{\"amount\":\"5\"}",
      "{\"amount\":true}",
      "{\"flag\":\"false\"}",
      "{\"flag\":\"true\"}",
      "{\"flag\":1}",
      "{\"flag\":0}",
      "{\"at\":5}",
      "{\"at\":5.5}",
      "{\"at\":true}",
      "{\"url\":5}",
      "{\"url\":true}",
    }
  )
  void anythingElseIsRefused(String json) {
    assertThatThrownBy(() -> read(json)).isInstanceOf(
      HttpMessageNotReadableException.class
    );
  }

  @Test
  void itReadsOnlyTheGatewaysOwnClasses() {
    assertThat(
      STRICT.canRead(Fields.class, MediaType.APPLICATION_JSON)
    ).isTrue();
    assertThat(STRICT.canRead(Map.class, MediaType.APPLICATION_JSON)).isFalse();
    assertThat(
      STRICT.canRead(String.class, MediaType.APPLICATION_JSON)
    ).isFalse();
    assertThat(
      STRICT.canWrite(Fields.class, MediaType.APPLICATION_JSON)
    ).isFalse();
  }
}
