package com.synapsedesk.gateway.openapi;

import io.swagger.v3.oas.models.Operation;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springdoc.core.customizers.OperationCustomizer;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;

/**
 * Publishes an operation's id the way the committed document spells it:
 * {@code Controller_method} with a {@code _v1} suffix on versioned routes (for
 * example {@code DepartmentsController_list_v1}).
 *
 * <p>Every handler is named for that id already, in camel case
 * ({@code departmentsControllerListV1}), and springdoc publishes the method name
 * as-is. So the rule only re-spells it: split at the controller name and at an
 * optional trailing {@code V<digits>}. A client generated from the document names
 * its methods from this id, so the spelling is part of the published contract.
 *
 * <p>A method whose name has no {@code Controller} in it is left as springdoc
 * names it, rather than guessed at.
 */
@Component
public class OperationIdCustomizer implements OperationCustomizer {

  private static final Pattern HANDLER_NAME = Pattern.compile(
    "^(.*?Controller)(.+?)(V\\d+)?$"
  );

  @Override
  public Operation customize(Operation operation, HandlerMethod handlerMethod) {
    String id = publishedId(handlerMethod.getMethod().getName());
    if (id != null) operation.setOperationId(id);

    return operation;
  }

  /** {@code departmentsControllerListV1} to {@code DepartmentsController_list_v1}; null if no controller name. */
  static String publishedId(String handlerName) {
    Matcher match = HANDLER_NAME.matcher(handlerName);
    if (!match.matches()) return null;
    String controller = match.group(1);
    String method = match.group(2);
    String version = match.group(3);

    return (
      capitalise(controller) +
      "_" +
      lowerFirst(method) +
      (version == null ? "" : "_" + version.toLowerCase())
    );
  }

  private static String capitalise(String text) {
    return Character.toUpperCase(text.charAt(0)) + text.substring(1);
  }

  private static String lowerFirst(String text) {
    return Character.toLowerCase(text.charAt(0)) + text.substring(1);
  }
}
