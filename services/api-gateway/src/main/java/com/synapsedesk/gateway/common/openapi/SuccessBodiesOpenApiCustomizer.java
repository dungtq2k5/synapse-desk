package com.synapsedesk.gateway.common.openapi;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.media.Schema;
import java.util.Set;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

/**
 * Publishes what a success body is, where the return type alone says the wrong thing.
 *
 * <ul>
 *   <li><b>A 204 has no body.</b> The handler returns the envelope type, so springdoc
 *       attached a JSON body to every 204; the protocol forbids one, and both gateways
 *       send none (measured).
 *   <li><b>An acknowledgement's {@code data} is {@code null}.</b> {@code ApiResponseVoid}
 *       is the envelope of a handler that answers with no data, and springdoc published
 *       its {@code data} as {@code {}}, "anything". Both gateways answer {@code null} on
 *       every such route (measured on the 7 that answer 200 or 202).
 * </ul>
 */
@Component
@Order(OpenApiCustomizerOrder.SUCCESS_BODIES)
public class SuccessBodiesOpenApiCustomizer implements OpenApiCustomizer {

  static final String VOID_ENVELOPE = "ApiResponseVoid";

  @Override
  @SuppressWarnings({ "rawtypes", "unchecked" })
  public void customise(OpenAPI openApi) {
    if (openApi.getPaths() != null) {
      openApi
        .getPaths()
        .values()
        .forEach(item ->
          item.readOperations().forEach(operation -> {
            if (operation.getResponses() == null) return;
            var noContent = operation.getResponses().get("204");
            if (noContent != null) noContent.setContent(null);
          })
        );
    }

    if (
      openApi.getComponents() != null &&
      openApi.getComponents().getSchemas() != null
    ) {
      Schema<?> envelope = openApi
        .getComponents()
        .getSchemas()
        .get(VOID_ENVELOPE);
      if (envelope != null && envelope.getProperties() != null) {
        Schema data = new Schema<>();
        data.setTypes(Set.of("null"));
        envelope.getProperties().put("data", data);
      }
    }
  }
}
