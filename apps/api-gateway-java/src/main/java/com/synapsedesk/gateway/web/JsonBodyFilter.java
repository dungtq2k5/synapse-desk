package com.synapsedesk.gateway.web;

import com.synapsedesk.gateway.error.ErrorMessages;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.HandlerExceptionResolver;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

/**
 * A body must be JSON, and must parse — decided BEFORE authentication.
 *
 * <p><b>The ordering is the point, not the statuses.</b> Measured on the Node
 * gateway with no cookie at all:
 *
 * <pre>
 * text/plain on PATCH /users/me  -> 415   (the middleware runs before the guard)
 * malformed JSON, same route     -> 400   (Express parses the body in middleware)
 * no body at all, same route     -> 401   (nothing to refuse, so the guard answers)
 * </pre>
 *
 * <p>Spring raises both of those at ARGUMENT RESOLUTION, which is after every
 * security filter — so a Java gateway without this filter answers 401 where
 * the Node one answers 415 or 400. The same request, a different status,
 * decided by which implementation happens to hold the lease. That is precisely
 * what the lease exists to make invisible.
 *
 * <p><b>The messages stay opaque</b>, by the rule in plan 81 §3: the refusal
 * text belongs to Jackson here and to V8 there, and three malformed bodies
 * produced three different V8 strings. The STATUS, the envelope and the path
 * are the contract.
 */
@Component
// **Servlet contexts only.** It depends on `handlerExceptionResolver`, which
// is a web bean — and `ConfigBindingTest` and `DotEnvIsNotReadTest` boot
// deliberately non-web applications to ask what the binder does. Without this
// they fail on a missing dependency, which says nothing about binding.
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class JsonBodyFilter extends OncePerRequestFilter {

  private final ObjectMapper json;
  private final HandlerExceptionResolver resolver;

  public JsonBodyFilter(
      ObjectMapper json,
      @Qualifier("handlerExceptionResolver") HandlerExceptionResolver resolver) {
    this.json = json;
    this.resolver = resolver;
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    byte[] body = request.getInputStream().readAllBytes();

    if (body.length == 0) {
      // No body is not a refusal: `POST /auth/logout` sends none, and a
      // gateway that demanded a Content-Type would break every caller that
      // correctly sends nothing.
      chain.doFilter(request, response);

      return;
    }

    String declared = request.getContentType();

    if (declared == null || !isJson(declared)) {
      refuse(
          request,
          response,
          HttpStatus.UNSUPPORTED_MEDIA_TYPE,
          "Content-Type must be application/json");

      return;
    }

    try {
      json.readTree(body);
    } catch (JacksonException malformed) {
      // Jackson's own text, deliberately — see the class note.
      refuse(request, response, HttpStatus.BAD_REQUEST, firstLine(malformed));

      return;
    }

    chain.doFilter(new CachedBodyRequest(request, body), response);
  }

  /**
   * Hands the refusal to the SAME advice that writes every other envelope.
   *
   * <p>A filter sits outside Spring MVC's exception handling, so a
   * `response.sendError` here would produce the container's error page and a
   * `response.getWriter().write(...)` would be a second place that knows the
   * envelope's shape. The resolver routes it through
   * `GatewayExceptionHandler` instead.
   */
  private void refuse(
      HttpServletRequest request,
      HttpServletResponse response,
      HttpStatus status,
      String reason) {
    resolver.resolveException(
        request, response, null, new ResponseStatusException(status, reason));
  }

  /** As the Node middleware does: a parameter or a `+json` suffix is fine. */
  private static boolean isJson(String contentType) {
    String essence = contentType.split(";")[0].trim().toLowerCase();

    return essence.equals("application/json") || essence.endsWith("+json");
  }

  private static String firstLine(JacksonException failure) {
    String detail = failure.getOriginalMessage();

    if (detail == null) {
      return ErrorMessages.format("Malformed request body");
    }

    int newline = detail.indexOf('\n');

    return newline < 0 ? detail : detail.substring(0, newline);
  }
}
