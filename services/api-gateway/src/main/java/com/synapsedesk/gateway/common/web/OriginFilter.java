package com.synapsedesk.gateway.common.web;

import com.synapsedesk.gateway.common.config.CorsProperties;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.HandlerExceptionResolver;

/**
 * Refuses a state-changing request whose {@code Origin} is present and foreign:
 * not this gateway's own origin and not one {@code CORS} allows. 403, before any
 * route and before the body is read.
 *
 * <p>Defense in depth beside {@code SameSite=Lax} cookies. Lax counts a sibling
 * subdomain as same-site, and a bodiless cross-site {@code POST} (a form with no
 * fields) passes {@link JsonBodyFilter}, which reads an empty body as {@code {}}.
 * A request with no {@code Origin} (a server, a webhook sender, {@code curl}) is
 * not a browser acting for someone and passes. {@code CORS = *} allows every
 * origin, so it allows every {@code Origin} here too.
 *
 * <p>The gateway's own origin is the {@code Host} header with the scheme a proxy
 * forwarded ({@code X-Forwarded-Proto}, first value), or the request's own.
 *
 * <pre>
 * POST /api/v1/auth/logout  Origin: https://evil.example.com  -> 403
 * POST /api/v1/auth/logout  Origin: (this gateway's origin)   -> passes
 * </pre>
 */
@Component
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@Order(Ordered.HIGHEST_PRECEDENCE + 6)
public class OriginFilter extends OncePerRequestFilter {

  private static final Set<String> UNSAFE = Set.of(
    "POST",
    "PUT",
    "PATCH",
    "DELETE"
  );

  private final List<String> allowed;
  private final HandlerExceptionResolver resolver;

  public OriginFilter(
    CorsProperties cors,
    @Qualifier("handlerExceptionResolver") HandlerExceptionResolver resolver
  ) {
    this.allowed = Arrays.stream(cors.origins().split(","))
      .map(String::trim)
      .filter(origin -> !origin.isEmpty())
      .toList();
    this.resolver = resolver;
  }

  @Override
  protected void doFilterInternal(
    HttpServletRequest request,
    HttpServletResponse response,
    FilterChain chain
  ) throws ServletException, IOException {
    String origin = request.getHeader("Origin");

    if (
      !UNSAFE.contains(request.getMethod()) ||
      origin == null ||
      allowed.contains("*") ||
      allowed.contains(origin) ||
      origin.equals(ownOrigin(request))
    ) {
      chain.doFilter(request, response);

      return;
    }

    resolver.resolveException(
      request,
      response,
      null,
      new ResponseStatusException(
        HttpStatus.FORBIDDEN,
        "Cross-origin request refused"
      )
    );
  }

  private static String ownOrigin(HttpServletRequest request) {
    String forwarded = request.getHeader("X-Forwarded-Proto");
    String scheme =
      forwarded == null ? request.getScheme() : forwarded.split(",")[0].trim();

    return scheme + "://" + request.getHeader("Host");
  }
}
