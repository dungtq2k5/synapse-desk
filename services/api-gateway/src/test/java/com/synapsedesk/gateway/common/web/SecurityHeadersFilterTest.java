package com.synapsedesk.gateway.common.web;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

/**
 * The CSP {@link SecurityHeadersFilter} sends: nothing inline is allowed, for
 * styles or scripts, and every directive the policy depends on is present.
 */
class SecurityHeadersFilterTest {

  @Test
  void theCspAllowsNothingInline() throws Exception {
    MockHttpServletResponse response = new MockHttpServletResponse();

    new SecurityHeadersFilter().doFilter(
      new MockHttpServletRequest("GET", "/health"),
      response,
      new MockFilterChain()
    );

    String csp = response.getHeader("Content-Security-Policy");
    assertThat(csp).doesNotContain("'unsafe-inline'");
    assertThat(csp.split("; ")).contains(
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'"
    );
  }
}
