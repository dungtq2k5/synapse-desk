package com.synapsedesk.gateway.common.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.synapsedesk.gateway.common.config.CorsProperties;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.HandlerExceptionResolver;

/**
 * The rule: a state-changing request with a present, foreign {@code Origin} is
 * refused with 403; an allowed origin, the gateway's own, no {@code Origin}, and
 * a read all pass.
 */
class OriginFilterTest {

  private static final String ALLOWED = "http://localhost:5173";

  private final HandlerExceptionResolver resolver = mock(
    HandlerExceptionResolver.class
  );

  private boolean passes(String allowed, MockHttpServletRequest request)
    throws Exception {
    MockFilterChain chain = new MockFilterChain();
    new OriginFilter(new CorsProperties(allowed), resolver).doFilter(
      request,
      new MockHttpServletResponse(),
      chain
    );

    return chain.getRequest() != null;
  }

  private static MockHttpServletRequest request(String method, String origin) {
    MockHttpServletRequest request = new MockHttpServletRequest(
      method,
      "/api/v1/auth/logout"
    );
    request.addHeader("Host", "gateway.test");
    if (origin != null) request.addHeader("Origin", origin);

    return request;
  }

  @Test
  void aForeignOriginOnAPostIsRefusedWith403() throws Exception {
    assertThat(
      passes(ALLOWED, request("POST", "https://evil.example.com"))
    ).isFalse();
    verify(resolver).resolveException(
      any(),
      any(),
      any(),
      argThat(
        error ->
          error instanceof ResponseStatusException refused &&
          refused.getStatusCode() == HttpStatus.FORBIDDEN
      )
    );
  }

  @Test
  void everyUnsafeMethodIsChecked() throws Exception {
    for (String method : new String[] { "POST", "PUT", "PATCH", "DELETE" }) {
      assertThat(passes(ALLOWED, request(method, "https://evil.example.com")))
        .as(method)
        .isFalse();
    }
  }

  @Test
  void anAllowedOriginTheGatewaysOwnAndNoOriginPass() throws Exception {
    assertThat(passes(ALLOWED, request("POST", ALLOWED))).isTrue();
    assertThat(
      passes(ALLOWED, request("POST", "http://gateway.test"))
    ).isTrue();
    assertThat(passes(ALLOWED, request("POST", null))).isTrue();
    verify(resolver, never()).resolveException(any(), any(), any(), any());
  }

  @Test
  void theForwardedSchemeMakesTheOwnOrigin() throws Exception {
    MockHttpServletRequest behindTls = request("POST", "https://gateway.test");
    behindTls.addHeader("X-Forwarded-Proto", "https");

    assertThat(passes(ALLOWED, behindTls)).isTrue();
    assertThat(
      passes(ALLOWED, request("POST", "https://gateway.test"))
    ).isFalse();
  }

  @Test
  void aReadIsNeverRefusedForItsOrigin() throws Exception {
    assertThat(
      passes(ALLOWED, request("GET", "https://evil.example.com"))
    ).isTrue();
  }

  @Test
  void aWildcardAllowsEveryOrigin() throws Exception {
    assertThat(
      passes("*", request("POST", "https://evil.example.com"))
    ).isTrue();
  }
}
