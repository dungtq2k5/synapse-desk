package com.synapsedesk.gateway.web;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import com.synapsedesk.gateway.config.CorsProperties;
import com.synapsedesk.gateway.throttle.ThrottlerTiers;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * `app.enableCors(...)`, reproduced — a custom filter rather than Spring's
 * {@code WebMvcConfigurer.addCorsMappings}, because the wildcard case needs
 * behaviour Spring's abstraction cannot express directly.
 *
 * <p><b>`CORS = *` is exact-matched, not treated as "allow everything".</b>
 * `cors.config.ts`'s own measurement: {@code origin: ["*"]} (an ARRAY
 * containing the string) produces NO {@code Access-Control-Allow-Origin} at
 * all against `cors@2.8.6` — an array matches an Origin header by exact
 * string equality, and no browser sends the literal Origin {@code "*"}. So
 * this filter does the same thing Node's array-membership check does: build
 * the parsed entries (which may literally contain the one-character string
 * {@code "*"}) and test the request's {@code Origin} header for exact
 * membership. A real origin never equals {@code "*"}, so the wildcard entry
 * naturally matches nothing — no special case needed, and no risk of
 * Spring's {@code allowedOrigins} rejecting {@code "*"} combined with
 * credentials, which would 500 every request instead of quietly refusing the
 * browser one.
 */
@Component
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@Order(Ordered.HIGHEST_PRECEDENCE + 5)
public class CorsFilter extends OncePerRequestFilter {

  private static final String ORIGIN = "Origin";

  /** Mirrors `CORS_ALLOWED_HEADERS` — a browser-required superset, not a controller-read list. */
  private static final String ALLOWED_HEADERS =
      String.join(
          ", ",
          "Content-Type",
          "Authorization",
          "X-Requested-With",
          "Idempotency-Key",
          "x-apollo-operation-name",
          "apollo-require-preflight");

  /** Mirrors `CORS_METHODS` — `OPTIONS` is deliberately absent; this filter answers preflight itself. */
  private static final String ALLOWED_METHODS = "GET, POST, PUT, PATCH, DELETE";

  /**
   * Mirrors `CORS_EXPOSED_HEADERS` — DERIVED from the tier names, the same
   * way `cors.config.ts` derives it, so a tier rename needs no second edit
   * here either (known gap 39's fix, reproduced rather than hand-copied).
   */
  private static final String EXPOSED_HEADERS = buildExposedHeaders();

  private final List<String> allowedOrigins;

  public CorsFilter(CorsProperties cors) {
    this.allowedOrigins = parseOrigins(cors.origins());
  }

  private static List<String> parseOrigins(String raw) {
    List<String> entries = new ArrayList<>();
    for (String value : raw.split(",")) {
      String trimmed = value.trim();
      if (!trimmed.isEmpty()) {
        entries.add(trimmed);
      }
    }

    return entries;
  }

  private static String buildExposedHeaders() {
    List<String> headers = new ArrayList<>();
    headers.add("Retry-After");
    for (String tier : List.of(ThrottlerTiers.SHORT, ThrottlerTiers.MEDIUM, ThrottlerTiers.LONG, ThrottlerTiers.AUTH)) {
      headers.add("X-RateLimit-Limit-" + tier);
      headers.add("X-RateLimit-Remaining-" + tier);
      headers.add("X-RateLimit-Reset-" + tier);
      headers.add("Retry-After-" + tier);
    }

    return String.join(", ", headers);
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    String origin = request.getHeader(ORIGIN);
    boolean isPreflight =
        "OPTIONS".equalsIgnoreCase(request.getMethod())
            && request.getHeader("Access-Control-Request-Method") != null;

    if (origin == null) {
      // No Origin header: not a browser cross-origin request (curl, a peer,
      // same-origin) — nothing to decide.
      chain.doFilter(request, response);

      return;
    }

    boolean allowed = allowedOrigins.contains(origin);

    if (isPreflight) {
      if (!allowed) {
        // Refused, same as `cors` calling back with an error for a strict
        // origin function: no CORS headers, and nothing behind this path
        // answers a bare OPTIONS, so the browser sees the preflight fail.
        response.setStatus(HttpStatus.FORBIDDEN.value());

        return;
      }

      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Access-Control-Allow-Credentials", "true");
      response.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS);
      response.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS);
      response.setHeader("Vary", ORIGIN);
      response.setStatus(HttpStatus.NO_CONTENT.value());

      return;
    }

    if (allowed) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Access-Control-Allow-Credentials", "true");
      response.setHeader("Access-Control-Expose-Headers", EXPOSED_HEADERS);
      response.setHeader("Vary", ORIGIN);
    }
    // Not allowed, not a preflight: Node's `cors` middleware omits the
    // headers and lets the request proceed — the browser's own same-origin
    // policy is what refuses the caller JS from reading the response, not a
    // server-side block, so a non-browser or same-origin caller is unaffected.

    chain.doFilter(request, response);
  }
}
