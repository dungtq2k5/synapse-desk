package com.synapsedesk.gateway.common.web;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;
import org.springframework.core.MethodParameter;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * Refuses a query name the route does not declare, with a 400, before any
 * handler or peer runs: an unsupported filter would otherwise return an
 * unfiltered list that looks filtered.
 *
 * <p><b>Only on a route that takes query parameters.</b> A route that declares
 * none ignores the query string entirely, and {@link AcceptsUndeclaredQuery}
 * exempts a route by name.
 *
 * <p><b>Names come from the query string, not the parameter map:</b> the
 * servlet's parameter map also holds the fields of a form-encoded body.
 * Repeating a declared name ({@code ?status=A&status=B}) is not refused here.
 *
 * <p><b>Registered last</b>, after the guards and the path id check, so a
 * caller without the permission is refused for that first.
 *
 * @example {@code GET /documents/{id}/chunks?status=INDEXED} answers 400,
 *     {@code property status should not exist!}
 */
@Component
public class UndeclaredQueryInterceptor implements HandlerInterceptor {

  private final Map<HandlerMethod, Set<String>> declaredByHandler =
    new ConcurrentHashMap<>();

  @Override
  public boolean preHandle(
    HttpServletRequest request,
    HttpServletResponse response,
    Object handler
  ) {
    if (!ApplicationRoutes.isApplicationHandler(handler)) return true;
    HandlerMethod method = (HandlerMethod) handler;
    if (method.hasMethodAnnotation(AcceptsUndeclaredQuery.class)) return true;

    String query = request.getQueryString();
    if (query == null || query.isEmpty()) return true;

    Set<String> declared = declaredByHandler.computeIfAbsent(
      method,
      UndeclaredQueryInterceptor::declaredNames
    );
    if (declared.isEmpty()) return true;

    Set<String> undeclared = new LinkedHashSet<>();
    for (String pair : query.split("&")) {
      if (pair.isEmpty()) continue;
      int equals = pair.indexOf('=');
      String name = URLDecoder.decode(
        equals < 0 ? pair : pair.substring(0, equals),
        StandardCharsets.UTF_8
      );
      if (!declared.contains(name)) undeclared.add(name);
    }
    if (undeclared.isEmpty()) return true;

    throw new ResponseStatusException(
      HttpStatus.BAD_REQUEST,
      undeclared
        .stream()
        .map(name -> "property " + name + " should not exist")
        .collect(Collectors.joining(", "))
    );
  }

  private static Set<String> declaredNames(HandlerMethod method) {
    Set<String> names = new LinkedHashSet<>();
    for (MethodParameter parameter : method.getMethodParameters()) {
      RequestParam param = parameter.getParameterAnnotation(RequestParam.class);
      if (param == null) continue;
      String name = param.name().isEmpty()
        ? parameter.getParameterName()
        : param.name();
      if (name != null) names.add(name);
    }
    return names;
  }
}
