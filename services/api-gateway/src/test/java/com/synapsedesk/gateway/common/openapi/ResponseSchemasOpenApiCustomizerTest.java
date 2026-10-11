package com.synapsedesk.gateway.common.openapi;

import static org.assertj.core.api.Assertions.assertThat;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.Operation;
import io.swagger.v3.oas.models.PathItem;
import io.swagger.v3.oas.models.Paths;
import io.swagger.v3.oas.models.media.Content;
import io.swagger.v3.oas.models.media.MediaType;
import io.swagger.v3.oas.models.media.ObjectSchema;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.media.StringSchema;
import io.swagger.v3.oas.models.parameters.RequestBody;
import io.swagger.v3.oas.models.responses.ApiResponse;
import io.swagger.v3.oas.models.responses.ApiResponses;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * The rule: in a schema only responses reach, every property is required, and one
 * that was not required (no {@code @NotNull}) is also nullable. No test names a
 * field, because the customizer does not.
 */
class ResponseSchemasOpenApiCustomizerTest {

  private final ResponseSchemasOpenApiCustomizer customizer =
    new ResponseSchemasOpenApiCustomizer();

  private static Schema<?> ref(String name) {
    return new Schema<>().$ref("#/components/schemas/" + name);
  }

  private static Content content(String schema) {
    return new Content().addMediaType(
      "application/json",
      new MediaType().schema(ref(schema))
    );
  }

  /** A document whose single operation takes {@code in} (if any) and answers 200 with {@code out}. */
  private static OpenAPI document(String in, String out, Schema<?>... schemas) {
    Operation operation = new Operation().responses(
      new ApiResponses().addApiResponse(
        "200",
        new ApiResponse().content(content(out))
      )
    );
    if (in != null) {
      operation.requestBody(new RequestBody().content(content(in)));
    }
    Components components = new Components();
    for (Schema<?> schema : schemas) {
      components.addSchemas(schema.getTitle(), schema);
    }

    return new OpenAPI()
      .components(components)
      .paths(new Paths().addPathItem("/x", new PathItem().post(operation)));
  }

  private static ObjectSchema named(String name) {
    ObjectSchema schema = new ObjectSchema();
    schema.setTitle(name);

    return schema;
  }

  @Test
  void aPropertyThatWasNotRequiredBecomesRequiredAndNullable() {
    ObjectSchema out = named("Out");
    out.addProperty("always", new StringSchema());
    out.addProperty("maybe", new StringSchema());
    out.setRequired(List.of("always"));

    customizer.customise(document(null, "Out", out));

    assertThat(out.getRequired()).containsExactlyInAnyOrder("always", "maybe");
    assertThat(
      ((Schema<?>) out.getProperties().get("maybe")).getTypes()
    ).containsExactlyInAnyOrder("string", "null");
  }

  @Test
  void aRequiredPropertyIsLeftNonNullable() {
    ObjectSchema out = named("Out");
    out.addProperty("always", new StringSchema());
    out.setRequired(List.of("always"));

    customizer.customise(document(null, "Out", out));

    assertThat(
      ((Schema<?>) out.getProperties().get("always")).getTypes()
    ).containsExactly("string");
  }

  @Test
  void aReferencedPropertyThatMayBeNullIsOneOfTheReferenceAndNull() {
    ObjectSchema out = named("Out");
    out.addProperty("child", ref("Child"));
    ObjectSchema child = named("Child");

    customizer.customise(document(null, "Out", out, child));

    Schema<?> property = (Schema<?>) out.getProperties().get("child");
    assertThat(property.get$ref()).isNull();
    assertThat(property.getOneOf()).hasSize(2);
    assertThat(property.getOneOf().get(0).get$ref()).isEqualTo(
      "#/components/schemas/Child"
    );
    assertThat(property.getOneOf().get(1).getTypes()).containsExactly("null");
  }

  @Test
  void aSchemaOnlyARequestReachesIsUntouched() {
    ObjectSchema in = named("In");
    in.addProperty("optional", new StringSchema());
    ObjectSchema out = named("Out");
    out.addProperty("x", new StringSchema());

    customizer.customise(document("In", "Out", in, out));

    assertThat(in.getRequired()).isNull();
    assertThat(
      ((Schema<?>) in.getProperties().get("optional")).getTypes()
    ).containsExactly("string");
  }

  @Test
  void aSchemaBothSidesReachIsLeftAloneRatherThanGuessedAt() {
    ObjectSchema shared = named("Shared");
    shared.addProperty("x", new StringSchema());

    customizer.customise(document("Shared", "Shared", shared));

    assertThat(shared.getRequired()).isNull();
  }

  @Test
  void itReachesASchemaThroughAnotherSchemasProperties() {
    ObjectSchema out = named("Out");
    out.addProperty("inner", ref("Inner"));
    out.setRequired(List.of("inner"));
    ObjectSchema inner = named("Inner");
    inner.addProperty("deep", new StringSchema());

    customizer.customise(document(null, "Out", out, inner));

    assertThat(inner.getRequired()).containsExactly("deep");
  }

  @Test
  void anUntypedPropertyIsRequiredAndLeftAsAnyValue() {
    ObjectSchema out = named("Out");
    out.addProperty("anything", new Schema<>());

    customizer.customise(document(null, "Out", out));

    assertThat(out.getRequired()).containsExactly("anything");
    assertThat(
      ((Schema<?>) out.getProperties().get("anything")).getTypes()
    ).isNull();
  }
}
