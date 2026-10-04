package com.synapsedesk.gateway.inbound;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * The inbound fixture payloads satisfy {@link InboundEmail} — the Node gateway's
 * {@code inbound-payload-contract.spec.ts}, over the SAME six JSON files.
 *
 * <p><b>JSON only — this is not a test of the Resend adapter.</b> The routing
 * rows deliver these fixtures through the real webhook, and a fixture the DTO
 * refuses would turn them into {@code invalid_payload} drops that assert nothing
 * about routing. The adapter has its own test, {@code ResendInboundMapperTest}.
 *
 * <p>Unknown properties FAIL, as the Node pipe's {@code forbidNonWhitelisted}
 * does: a fixture field the Java record does not know is a field the two DTOs
 * disagree about.
 */
class InboundPayloadContractTest {

  private static final Path PAYLOADS = Path.of(
    "..",
    "..",
    "test",
    "fixtures",
    "inbound-email",
    "payloads"
  );

  private static final JsonMapper JSON = JsonMapper.builder()
    .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
    .build();

  private static final Validator VALIDATOR =
    Validation.buildDefaultValidatorFactory().getValidator();

  static Stream<Path> fixtures() throws IOException {
    try (Stream<Path> files = Files.list(PAYLOADS)) {
      return files
        .filter(path -> path.toString().endsWith(".json"))
        .sorted()
        .toList()
        .stream();
    }
  }

  @Test
  void theFixtureDirectoryIsNotEmpty() throws IOException {
    // Guards the guard: a parameterised test over nothing passes silently, so an
    // empty or moved directory would report a perfectly satisfied contract.
    assertThat(fixtures().count()).isGreaterThanOrEqualTo(6);
  }

  @ParameterizedTest(name = "{0} validates against InboundEmail")
  @MethodSource("fixtures")
  void everyFixtureValidates(Path fixture) throws IOException {
    InboundEmail email = JSON.readValue(
      Files.readString(fixture),
      InboundEmail.class
    );

    // Named in the assertion so a failure says WHICH field, not "expected 0".
    assertThat(
      VALIDATOR.validate(email)
        .stream()
        .map(ConstraintViolation::getPropertyPath)
        .map(Object::toString)
    ).isEmpty();
  }

  @ParameterizedTest(name = "{0} carries text and html as keys")
  @MethodSource("fixtures")
  void everyFixtureCarriesTextAndHtmlAsKeys(Path fixture) throws IOException {
    // The DTO requires both present and allows both null, because "no text part"
    // and "the field was forgotten" are different facts.
    JsonNode payload = JSON.readTree(Files.readString(fixture));

    assertThat(
      List.of(payload.has("text"), payload.has("html"))
    ).containsExactly(true, true);
  }

  @Test
  void theAutoResponderFixtureCarriesTheLoopHeaders() throws IOException {
    // The one shape the loop guards need, and the one a transport that
    // forwarded only the body would silently lose.
    JsonNode payload = JSON.readTree(
      Files.readString(PAYLOADS.resolve("auto-responder.json"))
    );

    assertThat(
      payload.get("headers").get("auto-submitted").asString()
    ).isEqualTo("auto-replied");
  }
}
