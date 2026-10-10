package com.synapsedesk.gateway.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * The security headers on every response, the same set for every route.
 *
 * <p><b>The CSP allows nothing inline.</b> This gateway serves JSON and no page
 * of its own (`documentationProvider: none`, `annotationLibrary: none` in
 * `pom.xml`), so no directive needs `'unsafe-inline'`, and a policy that allowed
 * it would loosen what a page here may run for nothing. A future page that needs
 * an inline style or script is a change to this policy, made with that page.
 *
 * <p><b>Not configurable:</b> what a page this repository serves is allowed to
 * load is a product decision, not an environment variable.
 */
@Component
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@Order(Ordered.HIGHEST_PRECEDENCE + 6)
public class SecurityHeadersFilter extends OncePerRequestFilter {

  private static final String CSP = String.join(
    "; ",
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'"
  );

  @Override
  protected void doFilterInternal(
    HttpServletRequest request,
    HttpServletResponse response,
    FilterChain chain
  ) throws ServletException, IOException {
    response.setHeader("Content-Security-Policy", CSP);
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    response.setHeader("Origin-Agent-Cluster", "?1");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains"
    );
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-DNS-Prefetch-Control", "off");
    response.setHeader("X-Download-Options", "noopen");
    response.setHeader("X-Permitted-Cross-Domain-Policies", "none");
    response.setHeader("X-XSS-Protection", "0");
    // No X-Powered-By to remove: Spring never sends one.
    // crossOriginEmbedderPolicy is explicitly OFF in SECURITY_HEADERS —
    // omitted here for the same reason, not a gap.

    chain.doFilter(request, response);
  }
}
