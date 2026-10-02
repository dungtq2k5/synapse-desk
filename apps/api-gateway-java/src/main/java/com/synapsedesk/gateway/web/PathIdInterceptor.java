package com.synapsedesk.gateway.web;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Map;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.HandlerMapping;

/**
 * Refuses a path parameter that names an id and is not a UUID, with a 400,
 * before any handler or peer runs: Node's {@code ParseUUIDPipe} on every such
 * parameter, as one rule instead of an annotation on each.
 *
 * <p><b>The rule is a name:</b> a path variable called {@code id} or {@code
 * <something>Id}. The contract rows ({@code path-ids.contract-spec.ts}) select
 * the same parameters from the published document by the same name, so a new
 * route with an id is covered, and tested, without anyone remembering. A
 * variable that is not an id ({@code token}, {@code ticketNumber}, {@code name})
 * is untouched.
 *
 * <p><b>Registered last</b>, after throttling, permissions, the lifecycle gate
 * and the metrics recorder, because Node's pipes run after its guards and inside
 * its interceptors: a caller without the permission is refused for THAT, and a
 * malformed id is a counted request, as it is there.
 *
 * <p>This is enforcement the published document does not describe on either
 * gateway (the parameters are {@code type: string} with no {@code format:
 * uuid}); saying so in the document would be a separate, deliberate change.
 */
@Component
public class PathIdInterceptor implements HandlerInterceptor {

  private static final Pattern ID_NAME = Pattern.compile("^(id|\\w+Id)$");

  private static final Pattern UUID_SHAPE = Pattern.compile(
    "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
  );

  @Override
  @SuppressWarnings("unchecked")
  public boolean preHandle(
    HttpServletRequest request,
    HttpServletResponse response,
    Object handler
  ) {
    if (!ApplicationRoutes.isApplicationHandler(handler)) return true;

    Map<String, String> variables = (Map<String, String>) request.getAttribute(
      HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE
    );
    if (variables == null) return true;

    for (Map.Entry<String, String> variable : variables.entrySet()) {
      if (
        ID_NAME.matcher(variable.getKey()).matches() &&
        !UUID_SHAPE.matcher(variable.getValue()).matches()
      ) {
        throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST,
          "Validation failed (uuid is expected)"
        );
      }
    }

    return true;
  }
}
