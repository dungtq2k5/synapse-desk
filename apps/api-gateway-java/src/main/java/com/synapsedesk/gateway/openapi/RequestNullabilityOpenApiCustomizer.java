package com.synapsedesk.gateway.openapi;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.PathItem;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.parameters.Parameter;
import java.util.Map;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.stereotype.Component;

/**
 * Publishes what a request field really accepts about {@code null}: every OPTIONAL
 * property of a request body may be {@code null}, and no parameter in the URL may.
 *
 * <p><b>A body field.</b> Measured on both gateways by sending every optional field of
 * every JSON route absent and as an explicit {@code null}: it is accepted on all but two
 * (Node's own 500s). On most it means "absent"; on eleven it is an instruction (clear
 * the date of birth, replace the allowed domains with none). A client that serialises
 * its model with explicit nulls, which is common, sends one. The document used to say
 * "optional, not nullable" for most of them, because the annotation that makes springdoc
 * publish a null is the one the DTOs happen to carry, so this states the rule instead of
 * leaving it to the annotation: a property a request does not require is nullable. The
 * explicit-null contract rows hold it on both gateways.
 *
 * <p><b>A parameter.</b> A query string cannot carry a null, so an optional parameter is
 * published as its plain type. springdoc publishes {@code ["string", "null"]} for an
 * optional parameter that carries a {@code @Nullable}, which describes a value no client
 * can send.
 *
 * <p><b>Why a rule and not the annotation.</b> Swapping the deprecated Spring
 * {@code @Nullable} for JSpecify's changes which of these springdoc reads, and so
 * changed 87 request fields and 82 parameters in the published document with no change
 * in behaviour. With the rule, the annotation no longer decides what is published.
 */
@Component
public class RequestNullabilityOpenApiCustomizer implements OpenApiCustomizer {

  @Override
  @SuppressWarnings("rawtypes")
  public void customise(OpenAPI openApi) {
    if (openApi.getComponents() != null) {
      Map<String, Schema> schemas = openApi.getComponents().getSchemas();
      if (schemas != null) {
        for (String name : SchemaGraph.of(openApi).requestOnly()) {
          Schema<?> schema = schemas.get(name);
          if (schema == null || schema.getProperties() == null) continue;
          Map<String, Schema> properties = schema.getProperties();
          for (Map.Entry<String, Schema> property : properties.entrySet()) {
            boolean required =
              schema.getRequired() != null &&
              schema.getRequired().contains(property.getKey());
            if (!required) {
              property.setValue(SchemaGraph.nullable(property.getValue()));
            }
          }
        }
      }
    }

    if (openApi.getPaths() == null) return;
    for (PathItem item : openApi.getPaths().values()) {
      item.readOperations().forEach(operation -> {
        if (operation.getParameters() == null) return;
        for (Parameter parameter : operation.getParameters()) {
          if (parameter.getSchema() != null) {
            if (parameter.getSchema().getTypes() != null) {
              parameter.getSchema().getTypes().remove("null");
            }
          }
        }
      });
    }
  }
}
