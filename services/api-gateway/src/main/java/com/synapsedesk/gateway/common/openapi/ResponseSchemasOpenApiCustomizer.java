package com.synapsedesk.gateway.common.openapi;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.media.Schema;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

/**
 * Publishes what a response schema's properties really are: ALL of them required,
 * and nullable wherever {@code @NotNull} does not say otherwise.
 *
 * <p><b>Why every property is required.</b> The gateway serializes nulls (no
 * {@code @JsonInclude} on any DTO, no global inclusion setting), so a response
 * property's key is on the wire whether or not it has a value. springdoc publishes
 * as required only the properties carrying {@code @NotNull}, so a field that may be
 * null was published as OPTIONAL, which tells a generated client the key might be
 * absent, and as non-null, which tells it the value is never null: both wrong.
 *
 * <p><b>Why "not required" becomes "nullable".</b> A response property without
 * {@code @NotNull} is the one that may hold null. So the rule reads nothing new:
 * what the code already enforces ({@code @NotNull}) decides, and a property
 * springdoc left optional is added to {@code required} and given a null type. No
 * property is named. Measured against the published contract: of 704 properties in
 * 150 response schemas, 532 are required and not nullable and 172 are required and
 * nullable, and these two sets are exactly {@code @NotNull} present and absent.
 *
 * <p><b>Per schema, not per usage.</b> A schema reachable from a success response
 * and from no request body is a response schema. Measured, no schema is reachable
 * from both (transitively, in either document), so the rule never needs a schema to
 * be treated both ways; one that ever is reachable from both is left alone rather
 * than guessed at.
 *
 * <p>This includes the envelope wrappers' {@code warning}, which the gateway always
 * emits ({@code null} when there is nothing to say): published required and
 * nullable, because the key is always sent.
 */
@Component
@Order(OpenApiCustomizerOrder.RESPONSE_SCHEMAS)
public class ResponseSchemasOpenApiCustomizer implements OpenApiCustomizer {

  @Override
  @SuppressWarnings("rawtypes")
  public void customise(OpenAPI openApi) {
    if (openApi.getComponents() == null) return;
    Map<String, Schema> schemas = openApi.getComponents().getSchemas();
    if (schemas == null) return;

    for (String name : SchemaGraph.of(openApi).responseOnly()) {
      Schema<?> schema = schemas.get(name);
      if (schema == null || schema.getProperties() == null) continue;

      List<String> required =
        schema.getRequired() == null
          ? new ArrayList<>()
          : new ArrayList<>(schema.getRequired());
      Map<String, Schema> properties = schema.getProperties();
      for (Map.Entry<String, Schema> property : properties.entrySet()) {
        if (required.contains(property.getKey())) continue;
        required.add(property.getKey());
        property.setValue(SchemaGraph.nullable(property.getValue()));
      }
      schema.setRequired(required);
    }
  }
}
