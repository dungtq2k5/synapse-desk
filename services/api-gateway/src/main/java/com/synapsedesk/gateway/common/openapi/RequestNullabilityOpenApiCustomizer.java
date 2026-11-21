package com.synapsedesk.gateway.common.openapi;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;
import com.synapsedesk.gateway.GatewayApplication;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.PathItem;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.parameters.Parameter;
import java.lang.reflect.Method;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.util.ClassUtils;

/**
 * Publishes what a request field really accepts about {@code null}: an OPTIONAL
 * property of a request body is nullable exactly when {@code null} means something
 * there, and no parameter in the URL is.
 *
 * <p><b>A body field.</b> An optional field answers an explicit {@code null} with a 400
 * ({@code StrictRequestBodyConverter}), except the few whose setter declares what
 * {@code null} means with {@code @JsonSetter(nulls = …)}: clearing a date of birth, a
 * description, an override. This reads that declaration from the class itself, so the
 * document and the binding cannot disagree, and springdoc's reading of the
 * {@code @Nullable} annotations the DTOs carry decides nothing. A required field is
 * left as springdoc publishes it. The explicit-null contract rows hold the behavior.
 *
 * <p><b>A parameter.</b> A query string cannot carry a null, so an optional parameter is
 * published as its plain type. springdoc publishes {@code ["string", "null"]} for an
 * optional parameter that carries a {@code @Nullable}, which describes a value no client
 * can send.
 */
@Component
@Order(OpenApiCustomizerOrder.REQUEST_NULLABILITY)
public class RequestNullabilityOpenApiCustomizer implements OpenApiCustomizer {

  @Override
  @SuppressWarnings("rawtypes")
  public void customise(OpenAPI openApi) {
    if (openApi.getComponents() != null) {
      Map<String, Schema> schemas = openApi.getComponents().getSchemas();
      if (schemas != null) {
        Map<String, Set<String>> meanings = nullMeanings();
        for (String name : SchemaGraph.of(openApi).requestOnly()) {
          Schema<?> schema = schemas.get(name);
          if (schema == null || schema.getProperties() == null) continue;
          Set<String> meaningful = meanings.getOrDefault(name, Set.of());
          for (Map.Entry<String, Schema> property : schema
            .getProperties()
            .entrySet()) {
            boolean required =
              schema.getRequired() != null &&
              schema.getRequired().contains(property.getKey());
            if (required) continue;
            property.setValue(
              meaningful.contains(property.getKey())
                ? SchemaGraph.nullable(property.getValue())
                : SchemaGraph.nonNullable(property.getValue())
            );
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

  /**
   * For each REST DTO, by its published name (the class's simple name, unique per
   * {@code PackageLayoutTest}), the JSON properties whose setter declares a null
   * handling of its own.
   */
  static Map<String, Set<String>> nullMeanings() {
    ClassPathScanningCandidateComponentProvider scanner =
      new ClassPathScanningCandidateComponentProvider(false);
    scanner.addIncludeFilter((reader, factory) ->
      reader.getClassMetadata().getClassName().contains(".dto.rest.")
    );

    Map<String, Set<String>> meanings = new HashMap<>();
    for (var candidate : scanner.findCandidateComponents(
      GatewayApplication.class.getPackageName()
    )) {
      Class<?> type = ClassUtils.resolveClassName(
        candidate.getBeanClassName(),
        RequestNullabilityOpenApiCustomizer.class.getClassLoader()
      );
      Set<String> properties = new HashSet<>();
      for (Method method : type.getDeclaredMethods()) {
        JsonSetter setter = method.getAnnotation(JsonSetter.class);
        JsonProperty property = method.getAnnotation(JsonProperty.class);
        if (
          setter != null && setter.nulls() != Nulls.DEFAULT && property != null
        ) {
          properties.add(property.value());
        }
      }
      if (!properties.isEmpty()) meanings.put(type.getSimpleName(), properties);
    }

    return meanings;
  }
}
