package com.synapsedesk.gateway.modules.clienterrors;

import com.synapsedesk.gateway.common.contracts.ClientErrors;
import com.synapsedesk.gateway.common.web.ApiPaths;
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

/**
 * Refuses a browser error report over {@link #MAX_BYTES} with 413, by its
 * declared length, before {@code JsonBodyFilter} reads the body.
 */
@Component
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@Order(Ordered.HIGHEST_PRECEDENCE + 8)
public class ClientErrorSizeFilter extends OncePerRequestFilter {

  /** A report's largest body, in bytes. */
  static final long MAX_BYTES = ClientErrors.CLIENT_ERROR_MAX_BYTES;

  private static final String PATH = ApiPaths.V1 + "/client-errors";

  private final HandlerExceptionResolver resolver;

  public ClientErrorSizeFilter(
    @Qualifier("handlerExceptionResolver") HandlerExceptionResolver resolver
  ) {
    this.resolver = resolver;
  }

  @Override
  protected boolean shouldNotFilter(HttpServletRequest request) {
    return !request.getRequestURI().equals(PATH);
  }

  @Override
  protected void doFilterInternal(
    HttpServletRequest request,
    HttpServletResponse response,
    FilterChain chain
  ) throws ServletException, IOException {
    if (request.getContentLengthLong() > MAX_BYTES) {
      resolver.resolveException(
        request,
        response,
        null,
        new ResponseStatusException(
          HttpStatus.PAYLOAD_TOO_LARGE,
          "A report is at most " + MAX_BYTES + " bytes"
        )
      );

      return;
    }

    chain.doFilter(request, response);
  }
}
