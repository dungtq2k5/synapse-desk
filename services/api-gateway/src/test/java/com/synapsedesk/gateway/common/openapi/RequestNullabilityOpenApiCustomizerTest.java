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
import io.swagger.v3.oas.models.parameters.Parameter;
import io.swagger.v3.oas.models.parameters.RequestBody;
import io.swagger.v3.oas.models.responses.ApiResponse;
import io.swagger.v3.oas.models.responses.ApiResponses;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

/**
 * The rule: in a schema only requests reach, an optional property accepts null exactly
 * when its setter declares what null means, and a required one is left alone; and no
 * parameter in the URL accepts null. The declarations are read from the real DTOs, so
 * the tests name one: {@code UpdateDepartmentDto}, whose {@code description} clears.
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

  /** A string property as springdoc publishes an optional {@code @Nullable} one. */
  private static StringSchema nullableString() {
    StringSchema schema = new StringSchema();
    schema.addType("null");

    return schema;
  }

  @Test
  void anOptionalPropertyIsNullableOnlyWhereItsSetterDeclaresAMeaning() {
    ObjectSchema in = named("UpdateDepartmentDto");
    in.addProperty("description", new StringSchema());
    in.addProperty("name", nullableString());
    in.addProperty("always", nullableString());
    in.setRequired(List.of("always"));

    customizer.customise(
      document("UpdateDepartmentDto", "Out", List.of(), in, named("Out"))
    );

    assertThat(
      property(in, "description").getTypes()
    ).containsExactlyInAnyOrder("string", "null");
    assertThat(property(in, "name").getTypes()).containsExactly("string");
    assertThat(property(in, "always").getTypes()).containsExactlyInAnyOrder(
      "string",
      "null"
    );
    assertThat(in.getRequired()).containsExactly("always");
  }

  @Test
  void anOptionalReferenceAndEnumLoseTheirNull() {
    ObjectSchema in = named("In");
    Schema<?> nullType = new Schema<>();
    nullType.addType("null");
    in.addProperty(
      "nested",
      new Schema<>().addOneOfItem(ref("Other")).addOneOfItem(nullType)
    );
    StringSchema kind = nullableString();
    kind.setEnum(new ArrayList<>(Arrays.asList("A", null)));
    in.addProperty("kind", kind);

    customizer.customise(
      document("In", "Out", List.of(), in, named("Other"), named("Out"))
    );

    assertThat(property(in, "nested").get$ref()).endsWith("/Other");
    assertThat(property(in, "kind").getTypes()).containsExactly("string");
    assertThat(
      new ArrayList<Object>(property(in, "kind").getEnum())
    ).containsExactly("A");
  }

  @Test
  void applyingTheRuleTwiceChangesNothingTheSecondTime() {
    ObjectSchema in = named("UpdateDepartmentDto");
    in.addProperty("description", new StringSchema());
    OpenAPI document = document(
      "UpdateDepartmentDto",
      "Out",
      List.of(),
      in,
      named("Out")
    );

    customizer.customise(document);
    customizer.customise(document);

    assertThat(property(in, "description").getTypes()).hasSize(2);
  }

  /** The fields where null means something, as the explicit-null contract rows list them. */
  @Test
  void theDeclaredMeaningsAreTheTwelve() {
    assertThat(RequestNullabilityOpenApiCustomizer.nullMeanings()).isEqualTo(
      Map.of(
        "UpdateOwnProfileDto",
        Set.of("dob", "gender"),
        "UpdateUserDto",
        Set.of("dob", "gender", "phoneNumber"),
        "UpdateDepartmentDto",
        Set.of("description"),
        "UpdateRoleDto",
        Set.of("description"),
        "UpdateWebhookEndpointDto",
        Set.of("description"),
        "UpdateOrganizationSettingsDto",
        Set.of(
          "allowedEmailDomains",
          "maxDocumentBytesOverride",
          "maxAttachmentBytesOverride",
          "maxAttachmentsPerMessageOverride"
        )
      )
    );
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

    Schema<?> querySchema = query.getSchema();
    Schema<?> pathSchema = path.getSchema();
    assertThat(querySchema.getTypes()).containsExactly("string");
    assertThat(pathSchema.getTypes()).containsExactly("string");
  }

  @Test
  void aDocumentWithNothingToDoIsLeftAlone() {
    customizer.customise(new OpenAPI());
  }
}
