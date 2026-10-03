package com.synapsedesk.gateway.web;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import tools.jackson.databind.json.JsonMapper;

/** The three answers a bound DTO cannot give: left out, sent as null, sent with a value. */
class RawJsonBodyTest {

  private final RawJsonBody body = new RawJsonBody(
    JsonMapper.builder().build()
  );

  private static void requestWith(String json) {
    RequestContextHolder.setRequestAttributes(
      new ServletRequestAttributes(
        new CachedBodyRequest(
          new MockHttpServletRequest(),
          json.getBytes(StandardCharsets.UTF_8)
        )
      )
    );
  }

  @AfterEach
  void tearDown() {
    RequestContextHolder.resetRequestAttributes();
  }

  @Test
  void aKeyLeftOutIsNeitherPresentNorNull() {
    requestWith("{\"other\":1}");

    assertThat(body.has("dob")).isFalse();
    assertThat(body.isNull("dob")).isFalse();
  }

  @Test
  void aKeySentAsNullIsPresentAndNull() {
    requestWith("{\"dob\":null}");

    assertThat(body.has("dob")).isTrue();
    assertThat(body.isNull("dob")).isTrue();
  }

  @Test
  void aKeySentWithAValueIsPresentAndNotNull() {
    requestWith("{\"dob\":\"2000-01-01\"}");

    assertThat(body.has("dob")).isTrue();
    assertThat(body.isNull("dob")).isFalse();
  }

  @Test
  void anEmptyStringIsAValueNotANull() {
    requestWith("{\"dob\":\"\"}");

    assertThat(body.isNull("dob")).isFalse();
  }

  @Test
  void noCachedBodyReadsAsAnEmptyObject() {
    RequestContextHolder.setRequestAttributes(
      new ServletRequestAttributes(new MockHttpServletRequest())
    );

    assertThat(body.has("dob")).isFalse();
    assertThat(body.isNull("dob")).isFalse();
  }
}
