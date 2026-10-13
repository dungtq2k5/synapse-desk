package com.synapsedesk.gateway.common.openapi;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.Operation;
import io.swagger.v3.oas.models.PathItem;
import io.swagger.v3.oas.models.media.Content;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.parameters.Parameter;
import io.swagger.v3.oas.models.responses.ApiResponse;
import java.util.IdentityHashMap;
import java.util.Map;
import java.util.Set;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

/**
 * Removes a length or item bound that only restates its annotation's default,
 * wherever it appears in the document.
 *
 * <p>{@code @Size(min = 1)} sets no maximum, so its {@code max} is {@code
 * Integer.MAX_VALUE}; {@code @Size(max = 500)} sets no minimum, so its {@code min}
 * is 0. springdoc publishes both, so a field that declared one bound also publishes
 * the other as {@code maxItems: 2147483647} or {@code minLength: 0}: a client
 * generator then emits a two-billion-item bound, and the document claims a limit
 * nobody wrote.
 *
 * <p><b>A rule, not a list.</b> Nothing here names a field. A bound equal to what
 * {@code @Size} implies when it is not set carries no information, so it is dropped
 * for every schema, present or future, and a field that gives a real bound
 * ({@code @Size(max = 500)}, {@code @Size(min = 1)}) is untouched. The dropped
 * values are exactly four: maxItems and maxLength at {@code Integer.MAX_VALUE},
 * minItems and minLength at 0. {@code minimum} and {@code maximum} are not touched:
 * a 0 there is a written value, not a default.
 */
@Component
@Order(OpenApiCustomizerOrder.DEFAULT_BOUNDS)
public class DefaultBoundsOpenApiCustomizer implements OpenApiCustomizer {

  @Override
  public void customise(OpenAPI openApi) {
    Set<Schema<?>> seen = java.util.Collections.newSetFromMap(
      new IdentityHashMap<>()
    );

    if (openApi.getComponents() != null) {
      forEachValue(openApi.getComponents().getSchemas(), seen);
    }
    if (openApi.getPaths() != null) {
      for (PathItem item : openApi.getPaths().values()) {
        for (Operation operation : item.readOperations()) {
          if (operation.getParameters() != null) {
            for (Parameter parameter : operation.getParameters()) {
              strip(parameter.getSchema(), seen);
              content(parameter.getContent(), seen);
            }
          }
          if (operation.getRequestBody() != null) {
            content(operation.getRequestBody().getContent(), seen);
          }
          if (operation.getResponses() != null) {
            for (ApiResponse response : operation.getResponses().values()) {
              content(response.getContent(), seen);
            }
          }
        }
      }
    }
  }

  private static void content(Content content, Set<Schema<?>> seen) {
    if (content == null) return;
    content.values().forEach(media -> strip(media.getSchema(), seen));
  }

  private static void forEachValue(
    // swagger-core's maps are raw; each value is a schema.
    Map<String, ?> schemas,
    Set<Schema<?>> seen
  ) {
    if (schemas != null) {
      schemas.values().forEach(s -> strip((Schema<?>) s, seen));
    }
  }

  private static void strip(Schema<?> schema, Set<Schema<?>> seen) {
    if (schema == null || !seen.add(schema)) return;

    if (
      schema.getMaxLength() != null &&
      schema.getMaxLength() == Integer.MAX_VALUE
    ) {
      schema.setMaxLength(null);
    }
    if (
      schema.getMaxItems() != null && schema.getMaxItems() == Integer.MAX_VALUE
    ) {
      schema.setMaxItems(null);
    }
    if (schema.getMinLength() != null && schema.getMinLength() == 0) {
      schema.setMinLength(null);
    }
    if (schema.getMinItems() != null && schema.getMinItems() == 0) {
      schema.setMinItems(null);
    }

    forEachValue(schema.getProperties(), seen);
    strip(schema.getItems(), seen);
    if (schema.getAdditionalProperties() instanceof Schema<?> additional) {
      strip(additional, seen);
    }
    for (java.util.List<?> group : java.util.Arrays.asList(
      schema.getAllOf(),
      schema.getAnyOf(),
      schema.getOneOf(),
      schema.getPrefixItems()
    )) {
      if (group != null) group.forEach(s -> strip((Schema<?>) s, seen));
    }
    strip(schema.getNot(), seen);
  }
}
