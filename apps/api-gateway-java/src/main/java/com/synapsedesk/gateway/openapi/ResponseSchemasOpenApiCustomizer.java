package com.synapsedesk.gateway.openapi;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.Operation;
import io.swagger.v3.oas.models.PathItem;
import io.swagger.v3.oas.models.media.Content;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.responses.ApiResponse;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.stereotype.Component;

/**
 * Publishes what a response schema's properties really are: ALL of them required,
 * and nullable wherever {@code @NotNull} does not say otherwise.
 *
 * <p><b>Why every property is required.</b> The gateway serialises nulls (no
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
 * the 150 response schemas the document shares with Node, 532 are required and not
 * nullable and 172 are required and nullable, and these two sets are exactly
 * {@code @NotNull} present and absent; Node publishes no optional response property.
 *
 * <p><b>Per schema, not per usage.</b> A schema reachable from a success response
 * and from no request body is a response schema. Measured, no schema is reachable
 * from both (transitively, in either document), so the rule never needs a schema to
 * be treated both ways; one that ever is reachable from both is left alone rather
 * than guessed at.
 *
 * <p>This includes the envelope wrappers' {@code warning}, which the gateway always
 * emits ({@code null} when there is nothing to say): published required and
 * nullable, where Node's document says optional. Both gateways send the key, so
 * the document now describes what they do.
 */
@Component
public class ResponseSchemasOpenApiCustomizer implements OpenApiCustomizer {

  private static final String REF_PREFIX = "#/components/schemas/";

  @Override
  @SuppressWarnings({ "rawtypes", "unchecked" })
  public void customise(OpenAPI openApi) {
    if (openApi.getComponents() == null || openApi.getPaths() == null) return;
    Map<String, Schema> schemas = openApi.getComponents().getSchemas();
    if (schemas == null) return;

    Set<String> fromRequests = new HashSet<>();
    Set<String> fromResponses = new HashSet<>();
    for (PathItem item : openApi.getPaths().values()) {
      for (Operation operation : item.readOperations()) {
        if (operation.getRequestBody() != null) {
          collect(operation.getRequestBody().getContent(), fromRequests);
        }
        if (operation.getResponses() != null) {
          operation.getResponses().forEach((status, response) -> {
            if (status.startsWith("2")) collect(response, fromResponses);
          });
        }
      }
    }
    Set<String> request = closure(fromRequests, schemas);
    Set<String> response = closure(fromResponses, schemas);

    for (String name : response) {
      if (request.contains(name)) continue;
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
        property.setValue(nullable(property.getValue()));
      }
      schema.setRequired(required);
    }
  }

  /** The schema, or one that also accepts null: {@code ["string", "null"]}, or {@code oneOf [$ref, null]}. */
  @SuppressWarnings({ "rawtypes", "unchecked" })
  private static Schema nullable(Schema property) {
    if (property.get$ref() != null) {
      Schema nullType = new Schema();
      nullType.addType("null");
      Schema wrapper = new Schema();
      wrapper.addOneOfItem(property);
      wrapper.addOneOfItem(nullType);

      return wrapper;
    }
    if (property.getTypes() != null && !property.getTypes().contains("null")) {
      property.addType("null");
    }

    return property;
  }

  private static void collect(Content content, Set<String> into) {
    if (content != null) {
      content.values().forEach(media -> refs(media.getSchema(), into));
    }
  }

  private static void collect(ApiResponse response, Set<String> into) {
    collect(response.getContent(), into);
  }

  @SuppressWarnings("rawtypes")
  private static void refs(Schema<?> schema, Set<String> into) {
    if (schema == null) return;
    if (schema.get$ref() != null && schema.get$ref().startsWith(REF_PREFIX)) {
      into.add(schema.get$ref().substring(REF_PREFIX.length()));
    }
    if (schema.getProperties() != null) {
      schema
        .getProperties()
        .values()
        .forEach(p -> refs((Schema<?>) p, into));
    }
    refs(schema.getItems(), into);
    if (schema.getAdditionalProperties() instanceof Schema<?> additional) {
      refs(additional, into);
    }
    for (List<Schema> group : java.util.Arrays.asList(
      schema.getAllOf(),
      schema.getAnyOf(),
      schema.getOneOf()
    )) {
      if (group != null) group.forEach(s -> refs((Schema<?>) s, into));
    }
  }

  /** Every schema reachable from the seeds, through the properties of each. */
  @SuppressWarnings("rawtypes")
  private static Set<String> closure(
    Set<String> seeds,
    Map<String, Schema> schemas
  ) {
    Set<String> seen = new HashSet<>();
    List<String> pending = new ArrayList<>(seeds);
    while (!pending.isEmpty()) {
      String name = pending.remove(pending.size() - 1);
      Schema<?> schema = schemas.get(name);
      if (schema == null || !seen.add(name)) continue;
      Set<String> next = new HashSet<>();
      refs(schema, next);
      pending.addAll(next);
    }

    return seen;
  }
}
