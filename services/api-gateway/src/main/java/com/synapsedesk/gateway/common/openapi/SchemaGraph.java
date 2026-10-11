package com.synapsedesk.gateway.common.openapi;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.Operation;
import io.swagger.v3.oas.models.PathItem;
import io.swagger.v3.oas.models.media.Content;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.responses.ApiResponse;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Which component schemas a document's requests and responses reach, and the one way
 * a schema is made to accept null, for the customizers that publish a rule about
 * request bodies or about response bodies.
 *
 * <p>A schema is a REQUEST schema when a request body reaches it (through any number of
 * properties, items and compositions) and a RESPONSE schema when a success response
 * does. Measured, none is reachable from both, so {@link Reachable#requestOnly} and
 * {@link Reachable#responseOnly} are the two sets a rule works on; one that ever is
 * reachable from both is left to neither rather than guessed at.
 */
final class SchemaGraph {

  private static final String REF_PREFIX = "#/components/schemas/";

  private SchemaGraph() {}

  /** The closure of schemas reached from request bodies and from success responses. */
  record Reachable(Set<String> request, Set<String> response) {
    Set<String> requestOnly() {
      Set<String> only = new HashSet<>(request);
      only.removeAll(response);

      return only;
    }

    Set<String> responseOnly() {
      Set<String> only = new HashSet<>(response);
      only.removeAll(request);

      return only;
    }
  }

  @SuppressWarnings("rawtypes")
  static Reachable of(OpenAPI openApi) {
    Map<String, Schema> schemas =
      openApi.getComponents() == null
        ? null
        : openApi.getComponents().getSchemas();
    if (schemas == null || openApi.getPaths() == null) {
      return new Reachable(Set.of(), Set.of());
    }

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

    return new Reachable(
      closure(fromRequests, schemas),
      closure(fromResponses, schemas)
    );
  }

  /**
   * The schema, or one that also accepts null: {@code ["string", "null"]}, or {@code
   * oneOf [$ref, null]}.
   *
   * <p>An {@code enum} gets {@code null} as a value too: a value must ALSO be one of
   * the enum's, so {@code type: ["string", "null"]} beside an enum without null still
   * forbids null, and the schema would both allow and refuse it.
   */
  @SuppressWarnings({ "rawtypes", "unchecked" })
  static Schema nullable(Schema property) {
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
    if (property.getEnum() != null && !property.getEnum().contains(null)) {
      property.getEnum().add(null);
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
    for (List<Schema> group : Arrays.asList(
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
