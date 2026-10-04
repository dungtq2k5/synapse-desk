package com.synapsedesk.gateway.openapi;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.Operation;
import io.swagger.v3.oas.models.PathItem;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.parameters.Parameter;
import java.io.IOException;
import java.io.InputStream;
import java.util.Map;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Publishes the document's prose from {@code openapi/prose-overlay.json}: every
 * operation's summary and description, parameter and property descriptions, examples,
 * and the API's title and description.
 *
 * <p><b>Data, not annotations.</b> About 480 strings keyed by what they describe
 * ({@code GET /api/v1/tickets}, {@code GET /api/v1/tickets query:sortBy},
 * {@code TicketResponseDto.status}) in one reviewable file, rather than scattered over
 * the controllers and DTOs. {@code scripts/lib/prose-overlay.spec.ts} holds it
 * TWO-SIDED against the published document: an entry that lands on nothing (a renamed
 * route, a deleted field) fails, and so does an operation with no summary (a new route
 * shipped undescribed).
 *
 * <p><b>Runs last, and composes.</b> The nullability rules replace some properties with
 * a {@code oneOf} wrapper, which would swallow a description set before them, so this
 * runs after every other customizer. A property that already has a description (the
 * sentence {@link ConstraintPublishingCustomizer} appends for a rule no keyword can
 * state) keeps it: the overlay's text goes first and the existing text after it.
 */
@Component
@Order(Ordered.LOWEST_PRECEDENCE)
public class ProseOverlayOpenApiCustomizer implements OpenApiCustomizer {

  private static final String OVERLAY = "openapi/prose-overlay.json";

  private final JsonNode overlay;

  public ProseOverlayOpenApiCustomizer() {
    try (InputStream in = new ClassPathResource(OVERLAY).getInputStream()) {
      this.overlay = JsonMapper.builder().build().readTree(in);
    } catch (IOException missing) {
      throw new IllegalStateException("could not read " + OVERLAY, missing);
    }
  }

  @Override
  @SuppressWarnings("rawtypes")
  public void customise(OpenAPI openApi) {
    JsonNode info = overlay.get("info");
    if (info != null) {
      if (openApi.getInfo() == null) openApi.setInfo(new Info());
      openApi.getInfo().setTitle(info.get("title").asString());
      openApi.getInfo().setDescription(info.get("description").asString());
    }

    if (openApi.getPaths() != null) {
      openApi
        .getPaths()
        .forEach((path, item) ->
          item
            .readOperationsMap()
            .forEach((method, operation) ->
              describe(method.name() + " " + path, operation)
            )
        );
    }

    if (
      openApi.getComponents() != null &&
      openApi.getComponents().getSchemas() != null
    ) {
      Map<String, Schema> schemas = openApi.getComponents().getSchemas();
      overlay
        .get("properties")
        .properties()
        .forEach(entry -> {
          String key = entry.getKey();
          int dot = key.indexOf('.');
          Schema<?> owner = schemas.get(key.substring(0, dot));
          if (owner == null || owner.getProperties() == null) return;
          Schema<?> property = owner
            .getProperties()
            .get(key.substring(dot + 1));
          if (property == null) return;
          JsonNode text = entry.getValue().get("description");
          if (text != null) property.setDescription(
            compose(text.asString(), property.getDescription())
          );
          JsonNode example = entry.getValue().get("example");
          if (example != null) property.setExample(plain(example));
        });
    }
  }

  private void describe(String key, Operation operation) {
    JsonNode entry = overlay.get("operations").get(key);
    if (entry != null) {
      if (entry.has("summary")) operation.setSummary(
        entry.get("summary").asString()
      );
      if (entry.has("description")) {
        operation.setDescription(entry.get("description").asString());
      }
    }
    if (operation.getParameters() == null) return;
    for (Parameter parameter : operation.getParameters()) {
      JsonNode text = overlay
        .get("parameters")
        .get(key + " " + parameter.getIn() + ":" + parameter.getName());
      if (text != null) parameter.setDescription(text.asString());
    }
  }

  /** The overlay's text, then whatever was already there and is not already in it. */
  static String compose(String overlay, String existing) {
    if (existing == null || existing.isBlank() || overlay.contains(existing)) {
      return overlay;
    }

    return overlay + "\n\n" + existing;
  }

  private static Object plain(JsonNode value) {
    if (value.isNumber()) return value.numberValue();
    if (value.isBoolean()) return value.asBoolean();

    return value.isString() ? value.asString() : value.toString();
  }
}
