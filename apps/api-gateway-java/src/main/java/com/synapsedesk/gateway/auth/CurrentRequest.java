package com.synapsedesk.gateway.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * The raw servlet request/response, for a generated `*Api` interface method —
 * whose signature is fixed by the shared document and carries neither.
 *
 * <p>The standard Spring idiom for reaching them outside a method parameter:
 * the servlet filter chain binds both to the current thread before a
 * `DispatcherServlet` handler runs, and `RequestContextHolder` is where that
 * binding lives.
 */
public final class CurrentRequest {

  private CurrentRequest() {}

  public static HttpServletRequest request() {
    return attributes().getRequest();
  }

  public static HttpServletResponse response() {
    HttpServletResponse response = attributes().getResponse();
    if (response == null) {
      throw new IllegalStateException("no response bound to the current request");
    }

    return response;
  }

  private static ServletRequestAttributes attributes() {
    return (ServletRequestAttributes) RequestContextHolder.currentRequestAttributes();
  }
}
