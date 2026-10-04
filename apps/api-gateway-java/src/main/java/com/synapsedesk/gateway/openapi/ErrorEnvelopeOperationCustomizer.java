package com.synapsedesk.gateway.openapi;

import io.swagger.v3.oas.models.Operation;
import io.swagger.v3.oas.models.media.Content;
import io.swagger.v3.oas.models.media.MediaType;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.responses.ApiResponse;
import io.swagger.v3.oas.models.responses.ApiResponses;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import org.springdoc.core.customizers.OperationCustomizer;
import org.springframework.core.MethodParameter;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.method.HandlerMethod;

/**
 * Adds the error-envelope responses {@link ApiErrors} declares, plus the
 * three automatic ones — the Java equivalent of Node's {@code
 * ApiFilterErrors}. See {@link ApiErrors} for what is declared versus
 * derived, and why.
 *
 * <p><b>The schema is inlined per status, not a shared {@code $ref}</b> —
 * matching {@code errorResponse()} in Node's own
 * {@code api-response.decorator.ts} exactly, property for property,
 * including {@code path}'s fixed example value ({@code "/api/v1/tickets"}
 * on every route, not the route's own path — reproduced as-is, since the
 * document this compares against does the same). A shared component would
 * document the same shape but diff differently against that file.
 *
 * <p>Descriptions are Node's {@code ERROR_DESCRIPTIONS}, copied once. They
 * already appear verbatim in every generated {@code *Api.java} interface's
 * javadoc (openapi-generator carries a response's {@code description}
 * straight into the method comment), so this is the third copy of text that
 * already existed in two places — kept anyway, since neither of the other
 * two is reachable at runtime to read from.
 */
@Component
@Order(OpenApiCustomizerOrder.ERROR_ENVELOPE)
public class ErrorEnvelopeOperationCustomizer implements OperationCustomizer {

  private static final Map<String, String> DESCRIPTIONS = descriptions();
  private static final Set<String> TYPE_STRING = Set.of("string");

  @Override
  public Operation customize(Operation operation, HandlerMethod handlerMethod) {
    ApiErrors declared = handlerMethod.getMethodAnnotation(ApiErrors.class);
    boolean throttled = declared == null || declared.throttled();

    TreeSet<String> statuses = new TreeSet<>(
      java.util.Comparator.comparingInt(Integer::parseInt)
    );
    if (declared != null) {
      statuses.addAll(List.of(declared.value()));
    }
    statuses.add("500");
    if (throttled) {
      statuses.add("429");
    }
    if (hasRequestBody(handlerMethod)) {
      statuses.add("415");
    }

    ApiResponses responses = operation.getResponses();
    if (responses == null) {
      responses = new ApiResponses();
      operation.setResponses(responses);
    }
    for (String status : statuses) {
      responses.addApiResponse(status, errorResponse(status));
    }

    return operation;
  }

  private static boolean hasRequestBody(HandlerMethod handlerMethod) {
    for (MethodParameter parameter : handlerMethod.getMethodParameters()) {
      if (parameter.hasParameterAnnotation(RequestBody.class)) {
        return true;
      }
    }
    return false;
  }

  private static ApiResponse errorResponse(String status) {
    Schema<Object> schema = new Schema<>();
    schema.setTypes(Set.of("object"));
    schema.setRequired(
      List.of("success", "statusCode", "path", "timestamp", "error")
    );

    Schema<Boolean> success = new Schema<>();
    success.setTypes(Set.of("boolean"));
    success.setExample(false);
    schema.addProperty("success", success);

    Schema<Number> statusCode = new Schema<>();
    statusCode.setTypes(Set.of("number"));
    statusCode.setExample(Integer.valueOf(status));
    schema.addProperty("statusCode", statusCode);

    Schema<String> path = new Schema<>();
    path.setTypes(TYPE_STRING);
    path.setExample("/api/v1/tickets");
    schema.addProperty("path", path);

    Schema<String> timestamp = new Schema<>();
    timestamp.setTypes(TYPE_STRING);
    timestamp.setFormat("date-time");
    schema.addProperty("timestamp", timestamp);

    Schema<String> error = new Schema<>();
    error.setTypes(TYPE_STRING);
    schema.addProperty("error", error);

    MediaType mediaType = new MediaType();
    mediaType.setSchema(schema);

    Content content = new Content();
    content.addMediaType("application/json", mediaType);

    ApiResponse response = new ApiResponse();
    response.setDescription(DESCRIPTIONS.get(status));
    response.setContent(content);
    return response;
  }

  /** Node's `ERROR_DESCRIPTIONS`, `api-response.decorator.ts`, copied verbatim. */
  private static Map<String, String> descriptions() {
    Map<String, String> map = new LinkedHashMap<>();
    map.put("400", "Validation failed, or the request is malformed.");
    map.put("401", "No valid session cookie, or the session has expired.");
    map.put(
      "402",
      "The workspace has used its AI allowance. Reached only by routes that " +
        "GENERATE — it arrives as `PERMISSION_DENIED` carrying an `[http:402]` " +
        "marker precisely so it does not surface as 403 and send an admin " +
        "hunting role grants for a billing problem."
    );
    map.put(
      "403",
      "Authenticated, but lacking the permission this route requires."
    );
    map.put(
      "404",
      "No such resource — or one the caller may not see. The two are " +
        "deliberately indistinguishable, so a by-id route cannot be used as " +
        "an existence oracle across tenants."
    );
    map.put(
      "409",
      "The request conflicts with the current state of the resource."
    );
    map.put(
      "415",
      "The request carried a body in something other than `application/json`. " +
        "Added automatically to every route that reads a body, and to no other."
    );
    map.put(
      "422",
      "Well-formed, but semantically rejected by a business rule."
    );
    map.put(
      "429",
      "Rate limited. Nearly every route is throttled — see the tier on the " +
        "route. The exceptions are the webhook intakes, which carry no 429 at all."
    );
    map.put(
      "500",
      "Unexpected server error. The response body carries no internals."
    );
    map.put(
      "503",
      "A dependency this route REFUSES without could not be reached. Carried " +
        "only by routes whose check may not degrade — a plan change verifies " +
        "usage before it is applied, and an unreadable usage leg is a refusal " +
        "rather than an allow with that dimension unchecked."
    );
    return map;
  }
}
