package com.synapsedesk.gateway.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.servlet.HandlerExceptionResolver;
import tools.jackson.databind.json.JsonMapper;

/**
 * The rule: a request that arrives with NO body is handed on as the empty JSON object
 * {@code {}}, on the methods that carry a body, whatever Content-Type came with it,
 * and is left alone otherwise.
 */
class JsonBodyFilterTest {

  private final JsonBodyFilter filter = new JsonBodyFilter(
    JsonMapper.builder().build(),
    mock(HandlerExceptionResolver.class)
  );

  private HttpServletRequest handedOn(MockHttpServletRequest request)
    throws Exception {
    AtomicReference<HttpServletRequest> seen = new AtomicReference<>();
    filter.doFilter(
      request,
      new MockHttpServletResponse(),
      new MockFilterChain() {
        @Override
        public void doFilter(
          jakarta.servlet.ServletRequest handed,
          jakarta.servlet.ServletResponse response
        ) {
          seen.set((HttpServletRequest) handed);
        }
      }
    );

    return seen.get();
  }

  private static String bodyOf(HttpServletRequest request) throws Exception {
    return new String(
      request.getInputStream().readAllBytes(),
      StandardCharsets.UTF_8
    );
  }

  @Test
  void aBodilessPostIsHandedOnAsAnEmptyJsonObject() throws Exception {
    HttpServletRequest handed = handedOn(
      new MockHttpServletRequest("POST", "/api/v1/tickets/1/resolve")
    );

    assertThat(bodyOf(handed)).isEqualTo("{}");
    assertThat(handed.getContentType()).isEqualTo("application/json");
    assertThat(handed.getHeader("content-type")).isEqualTo("application/json");
    assertThat(handed.getContentLength()).isEqualTo(2);
  }

  @Test
  void everyMethodThatCarriesABodyGetsOne() throws Exception {
    for (String method : new String[] { "POST", "PUT", "PATCH", "DELETE" }) {
      assertThat(bodyOf(handedOn(new MockHttpServletRequest(method, "/x"))))
        .as(method)
        .isEqualTo("{}");
    }
  }

  @Test
  void aDeclaredTextPlainContentTypeDoesNotSurviveAnEmptyBody()
    throws Exception {
    MockHttpServletRequest request = new MockHttpServletRequest("POST", "/x");
    request.setContentType("text/plain");

    HttpServletRequest handed = handedOn(request);

    assertThat(handed.getContentType()).isEqualTo("application/json");
    assertThat(
      java.util.Collections.list(handed.getHeaders("Content-Type"))
    ).containsExactly("application/json");
  }

  @Test
  void aGetIsLeftAlone() throws Exception {
    MockHttpServletRequest request = new MockHttpServletRequest("GET", "/x");

    assertThat(handedOn(request)).isSameAs(request);
  }

  @Test
  void aRequestThatDoesCarryABodyKeepsIt() throws Exception {
    MockHttpServletRequest request = new MockHttpServletRequest("POST", "/x");
    request.setContentType("application/json");
    request.setContent("{\"a\":1}".getBytes(StandardCharsets.UTF_8));

    assertThat(bodyOf(handedOn(request))).isEqualTo("{\"a\":1}");
  }
}
