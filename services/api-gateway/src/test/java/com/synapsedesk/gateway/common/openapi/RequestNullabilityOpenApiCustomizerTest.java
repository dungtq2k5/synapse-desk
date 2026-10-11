package com.synapsedesk.gateway.common.openapi;

import static org.assertj.core.api.Assertions.assertThat;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.Operation;
import io.swagger.v3.oas.models.PathItem;
import io.swagger.v3.oas.models.Paths;
import io.swagger.v3.oas.models.media.ArraySchema;
import io.swagger.v3.oas.models.media.Content;
import io.swagger.v3.oas.models.media.MediaType;
import io.swagger.v3.oas.models.media.ObjectSchema;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.media.StringSchema;
import io.swagger.v3.oas.models.parameters.Parameter;
import io.swagger.v3.oas.models.parameters.RequestBody;
import io.swagger.v3.oas.models.responses.ApiResponse;
import io.swagger.v3.oas.models.responses.ApiResponses;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * The rule: in a schema only requests reach, an optional property accepts null and a
 * required one does not; and no parameter in the URL accepts null. No test names a field,
 * because the customizer does not.
 */
class RequestNullabilityOpenApiCustomizerTest {

  private final RequestNullabilityOpenApiCustomizer customizer =
    new RequestNullabilityOpenApiCustomizer();

  private static Schema<?> ref(String name) {
    return new Schema<>().$ref("#/components/schemas/" + name);
  }

  private static Content content(String schema) {
    return new Content().addMediaType(
      "application/json",
      new MediaType().schema(ref(schema))
    );
  }

  private static ObjectSchema named(String name) {
    ObjectSchema schema = new ObjectSchema();
    schema.setTitle(name);

    return schema;
  }

  /** One operation taking {@code in} as its body and answering 200 with {@code out}. */
  private static OpenAPI document(
    String in,
    String out,
    List<Parameter> parameters,
    Schema<?>... schemas
  ) {
    Operation operation = new Operation()
      .requestBody(new RequestBody().content(content(in)))
      .responses(
        new ApiResponses().addApiResponse(
          "200",
          new ApiResponse().content(content(out))
        )
      );
    operation.setParameters(parameters);
    Components components = new Components();
    for (Schema<?> schema : schemas) {
      components.addSchemas(schema.getTitle(), schema);
    }

    return new OpenAPI()
      .components(components)
      .paths(new Paths().addPathItem("/x", new PathItem().post(operation)));
  }

  private static Schema<?> property(Schema<?> owner, String name) {
    return (Schema<?>) owner.getProperties().get(name);
  }

  @Test
  void anOptionalPropertyBecomesNullableAndARequiredOneDoesNot() {
    ObjectSchema in = named("In");
    in.addProperty("always", new StringSchema());
    in.addProperty("maybe", new StringSchema());
    in.setRequired(List.of("always"));

    customizer.customise(document("In", "Out", List.of(), in, named("Out")));

    assertThat(property(in, "maybe").getTypes()).containsExactlyInAnyOrder(
      "string",
      "null"
    );
    assertThat(property(in, "always").getTypes()).containsExactly("string");
    assertThat(in.getRequired()).containsExactly("always");
  }

  @Test
  void anOptionalListAndAnOptionalReferenceAreNullableToo() {
    ObjectSchema in = named("In");
    ArraySchema list = new ArraySchema();
    list.setItems(new StringSchema());
    in.addProperty("list", list);
    in.addProperty("nested", ref("Other"));

    customizer.customise(
      document("In", "Out", List.of(), in, named("Other"), named("Out"))
    );

    assertThat(property(in, "list").getTypes()).contains("null");
    assertThat(property(in, "nested").getOneOf()).hasSize(2);
    assertThat(property(in, "nested").getOneOf().get(1).getTypes()).contains(
      "null"
    );
  }

  @Test
  void applyingTheRuleTwiceChangesNothingTheSecondTime() {
    ObjectSchema in = named("In");
    in.addProperty("maybe", new StringSchema());
    OpenAPI document = document("In", "Out", List.of(), in, named("Out"));

    customizer.customise(document);
    customizer.customise(document);

    assertThat(property(in, "maybe").getTypes()).hasSize(2);
  }

  @Test
  void aSchemaAResponseReachesIsLeftAlone() {
    ObjectSchema out = named("Out");
    out.addProperty("maybe", new StringSchema());

    customizer.customise(document("In", "Out", List.of(), named("In"), out));

    assertThat(property(out, "maybe").getTypes()).containsExactly("string");
  }

  @Test
  void aParameterNeverAcceptsNull() {
    StringSchema optional = new StringSchema();
    optional.addType("null");
    Parameter query = new Parameter().name("q").in("query").schema(optional);
    Parameter path = new Parameter()
      .name("id")
      .in("path")
      .schema(new StringSchema());

    customizer.customise(
      document("In", "Out", List.of(query, path), named("In"), named("Out"))
    );

    assertThat(query.getSchema().getTypes()).containsExactly("string");
    assertThat(path.getSchema().getTypes()).containsExactly("string");
  }

  @Test
  void aDocumentWithNothingToDoIsLeftAlone() {
    customizer.customise(new OpenAPI());
  }
}
