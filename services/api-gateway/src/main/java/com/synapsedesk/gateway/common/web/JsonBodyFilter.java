package com.synapsedesk.gateway.common.web;

import com.synapsedesk.gateway.common.error.ErrorMessages;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
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
 * <p><b>The ordering is the point, not the statuses.</b> With no cookie at all:
 *
 * <pre>
 * text/plain on PATCH /users/me  -> 415   (refused here, before authentication)
 * malformed JSON, same route     -> 400   (parsed here, before authentication)
 * no body at all, same route     -> 401   (nothing to refuse, so authentication answers)
 * </pre>
 *
 * <p>Spring raises the first two at ARGUMENT RESOLUTION, which is after every
 * security filter — so without this filter both would answer 401.
 *
 * <p><b>The messages stay opaque</b>, deliberately: the refusal text belongs
 * to Jackson, and a parser can word three malformed bodies three different
 * ways. The STATUS, the envelope and the path are the contract.
 */
@Component
// **Servlet contexts only.** It depends on `handlerExceptionResolver`, which
// is a web bean — and `ConfigBindingTest` and `DotEnvIsNotReadTest` boot
// deliberately non-web applications to ask what the binder does. Without this
// they fail on a missing dependency, which says nothing about binding.
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class JsonBodyFilter extends OncePerRequestFilter {

  private static final byte[] EMPTY_OBJECT = "{}".getBytes(
    StandardCharsets.UTF_8
  );

  private final ObjectMapper json;
  private final HandlerExceptionResolver resolver;

  public JsonBodyFilter(
    ObjectMapper json,
    @Qualifier("handlerExceptionResolver") HandlerExceptionResolver resolver
  ) {
    this.json = json;
    this.resolver = resolver;
  }

  @Override
  protected void doFilterInternal(
    HttpServletRequest request,
    HttpServletResponse response,
    FilterChain chain
  ) throws ServletException, IOException {
    byte[] body = request.getInputStream().readAllBytes();

    if (body.length == 0) {
      // No body is not a refusal: `POST /auth/logout` sends none, and a
      // gateway that demanded a Content-Type would break every caller that
      // correctly sends nothing.
      //
      // The empty body is handed on as the empty JSON object `{}`, whatever
      // Content-Type came with it, so a route whose body is all-optional is
      // SERVED a bare POST and a route with a required field answers 400 for
      // the field. Without this, Spring would refuse the request with 415 at
      // routing (a `consumes` condition needs a Content-Type).
      chain.doFilter(
        carriesABody(request.getMethod())
          ? new CachedBodyRequest(request, EMPTY_OBJECT, true)
          : request,
        response
      );

      return;
    }

    String declared = request.getContentType();

    if (declared == null || !isJson(declared)) {
      refuse(
        request,
        response,
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        "Content-Type must be application/json"
      );

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
    String reason
  ) {
    resolver.resolveException(
      request,
      response,
      null,
      new ResponseStatusException(status, reason)
    );
  }

  /** The methods whose route may read a body; a GET has none to supply. */
  private static boolean carriesABody(String method) {
    return switch (method) {
      case "POST", "PUT", "PATCH", "DELETE" -> true;
      default -> false;
    };
  }

  /** JSON by its essence: a media-type parameter or a `+json` suffix is fine. */
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
