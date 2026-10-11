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
import io.swagger.v3.oas.models.responses.ApiResponse;
import io.swagger.v3.oas.models.responses.ApiResponses;
import org.junit.jupiter.api.Test;

/** The rule: a 204 has no body, and an acknowledgement's data is null. */
class SuccessBodiesOpenApiCustomizerTest {

  private final SuccessBodiesOpenApiCustomizer customizer =
    new SuccessBodiesOpenApiCustomizer();

  private static ApiResponse withBody() {
    return new ApiResponse().content(
      new Content().addMediaType(
        "application/json",
        new MediaType().schema(
          new Schema<>().$ref("#/components/schemas/ApiResponseVoid")
        )
      )
    );
  }

  private static OpenAPI document(ObjectSchema envelope) {
    Operation operation = new Operation().responses(
      new ApiResponses()
        .addApiResponse("204", withBody())
        .addApiResponse("200", withBody())
    );

    return new OpenAPI()
      .paths(new Paths().addPathItem("/x", new PathItem().delete(operation)))
      .components(new Components().addSchemas("ApiResponseVoid", envelope));
  }

  @Test
  void aNoContentResponsePublishesNoBodyAndAnOkResponseKeepsItsOwn() {
    OpenAPI document = document(new ObjectSchema());

    customizer.customise(document);

    ApiResponses responses = document
      .getPaths()
      .get("/x")
      .getDelete()
      .getResponses();
    assertThat(responses.get("204").getContent()).isNull();
    assertThat(responses.get("200").getContent()).isNotNull();
  }

  @Test
  void anAcknowledgementsDataIsNull() {
    ObjectSchema envelope = new ObjectSchema();
    envelope.addProperty("data", new Schema<>());

    customizer.customise(document(envelope));

    assertThat(
      ((Schema<?>) envelope.getProperties().get("data")).getTypes()
    ).containsExactly("null");
  }
}
