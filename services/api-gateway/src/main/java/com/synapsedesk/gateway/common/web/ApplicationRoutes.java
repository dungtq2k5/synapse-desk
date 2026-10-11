package com.synapsedesk.gateway.common.web;

import org.springframework.web.method.HandlerMethod;

/**
 * Whether a handler is one of THIS gateway's routes, as opposed to the framework's own.
 *
 * <p>The generated documentation and the container's error dispatch are MVC handler
 * methods too, but not routes of this gateway, so neither the request metrics nor the
 * lifecycle gate may see them.
 */
public final class ApplicationRoutes {

  private ApplicationRoutes() {}

  public static boolean isApplicationHandler(Object handler) {
    if (!(handler instanceof HandlerMethod method)) return false;

    String bean = method.getBeanType().getName();

    return (
      !bean.startsWith("org.springdoc.") && !bean.contains("ErrorController")
    );
  }
}
