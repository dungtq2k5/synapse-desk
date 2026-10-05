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
 * `helmet(SECURITY_HEADERS)`, reproduced — `security-headers.config.ts`'s
 * declared values, plus the helmet v8.3.0 defaults it does not override
 * (read from `node_modules/helmet/index.cjs`, since the values are the
 * library's own and not written down anywhere in this repository otherwise).
 *
 * <p><b>Byte-identical CSP, including `style-src 'self' 'unsafe-inline'`.</b>
 * That directive exists in Node only because Nest's Swagger template emits
 * an unconditional inline {@code <style>} reset — a page this gateway never
 * serves (`documentationProvider: none`, `annotationLibrary: none` in
 * `pom.xml`). It is inert here, not load-bearing. Kept anyway: the header
 * TEXT is authored in this repository, so it is exactly the kind of string
 * two implementations are held byte-equal on, and dropping a directive
 * because nothing currently needs it would be inheriting whichever one falls
 * out implicitly, rather than a decision made on purpose. A future Java-only
 * reason to tighten it is a deliberate, documented, second decision — not
 * this one.
 *
 * <p><b>Not configurable.</b> Node's is too, in the same file, for the same
 * reason: what a page this repository serves is allowed to load is a product
 * decision, not an environment variable.
 */
@Component
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@Order(Ordered.HIGHEST_PRECEDENCE + 6)
public class SecurityHeadersFilter extends OncePerRequestFilter {

  private static final String CSP = String.join(
    "; ",
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
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
