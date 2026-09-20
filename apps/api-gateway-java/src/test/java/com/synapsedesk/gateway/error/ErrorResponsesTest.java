package com.synapsedesk.gateway.error;

import static org.assertj.core.api.Assertions.assertThat;

import com.synapsedesk.gateway.HttpProbe;
import com.synapsedesk.gateway.config.SharedEnvironmentInitializer;
import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * The error envelope over real HTTP, against the re-taken P3 capture.
 *
 * <p><b>A test-only route, because the skeleton has no POST yet.</b> What is
 * under test is the ADVICE, not a route: a validated body and a throwing
 * handler are the smallest things that reach it. When real routes land they
 * exercise the same advice, and this stays as the row that isolates it.
 *
 * <p>Each row is labelled with which kind of contract it asserts — exact,
 * opaque, or split — because that distinction is the whole design here and is
 * invisible from the assertions alone.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "management.server.port=0")
@org.springframework.test.context.ContextConfiguration(
    initializers = SharedEnvironmentInitializer.class)
@Import(ErrorResponsesTest.Probes.class)
class ErrorResponsesTest {

  @Value("${local.server.port}")
  private int port;

  /** The smallest surface that reaches every branch of the advice. */
  @TestConfiguration
  @RestController
  static class Probes {

    /**
     * **`@NotNull` beside `@Email` is not redundant** — measured. Bean
     * Validation's `@Email` PASSES on null, while class-validator's
     * `@IsEmail` rejects an absent value, so a body of `{}` produced one
     * violation here and two on the Node side. The generated models get
     * `@NotNull` from the document's `required` array, which is exactly what
     * plan 82 corrected; this probe mirrors that.
     */
    record Credentials(
        @NotNull @Email String email, @NotNull @NotBlank String password) {}

    @PostMapping("/probe/validated")
    String validated(@Valid @RequestBody Credentials body) {
      return body.email();
    }

    @PostMapping("/probe/peer-down")
    String peerDown() {
      throw new StatusRuntimeException(
          Status.UNAVAILABLE.withDescription(
              "No connection established to localhost:59999"));
    }

    @PostMapping("/probe/marked")
    String marked() {
      throw new StatusRuntimeException(
          Status.INTERNAL.withDescription("[http:402] Your plan does not include this"));
    }
  }

  /** Every failure carries the same five fields, in the same order. */
  private void assertEnvelope(HttpProbe response, int status, String path) {
    Map<String, Object> body = response.json();

    assertThat(response.status()).isEqualTo(status);
    assertThat(body).containsEntry("success", false).containsEntry("statusCode", status);
    assertThat(body).containsEntry("path", path);
    assertThat(body.get("timestamp")).asString().isNotEmpty();
    assertThat(body.get("error")).asString().endsWith("!");
    // One string, never an array — the P3 capture's first property.
    assertThat(body.get("error")).isInstanceOf(String.class);
    assertThat(new java.util.ArrayList<>(body.keySet()))
        .containsExactly("success", "statusCode", "path", "timestamp", "error");
  }

  @Test
  void unknownRouteIsExact() {
    // OURS: `Cannot GET /x!` is written in this repository, so it is a
    // byte-equal contract.
    HttpProbe response = HttpProbe.get(port, "/api/v1/does-not-exist");

    assertEnvelope(response, 404, "/api/v1/does-not-exist");
    assertThat(response.json().get("error")).isEqualTo("Cannot GET /api/v1/does-not-exist!");
  }

  @Test
  void aPeerThatIsDownIsExactAndNamesNoAddress() {
    // OURS, and gap 38: the fixed transport message, in every environment.
    HttpProbe response = HttpProbe.post(port, "/probe/peer-down", "{}");

    assertEnvelope(response, 503, "/probe/peer-down");
    assertThat(response.json().get("error"))
        .isEqualTo("A service this request depends on is unavailable. Try again shortly!");
    assertThat(response.body()).doesNotContain("59999");
  }

  @Test
  void aMarkedMessageKeepsItsStatusAndText() {
    HttpProbe response = HttpProbe.post(port, "/probe/marked", "{}");

    assertEnvelope(response, 402, "/probe/marked");
    assertThat(response.json().get("error")).isEqualTo("Your plan does not include this!");
  }

  @Test
  void aValidationFailureIsSplit() {
    HttpProbe response = HttpProbe.post(port, "/probe/validated", "{}");
    String error = (String) response.json().get("error");

    assertEnvelope(response, 400, "/probe/validated");

    // EXACT — ours: the envelope, the `, ` separator, the trailing `!`, and
    // the field names being present and leading each fragment.
    assertThat(error).endsWith("!");
    assertThat(error).contains(ErrorMessages.SEPARATOR);
    assertThat(error).contains("email");
    assertThat(error).contains("password");

    // LOOSE — the library's: each constraint's phrasing. Bean Validation
    // writes "must be a well-formed email address" where class-validator
    // writes "must be an email", and pinning either would make one library's
    // wording the published contract.
    assertThat(error.split(ErrorMessages.SEPARATOR)).hasSizeGreaterThanOrEqualTo(2);
  }

  @Test
  void aMissingFieldIsReportedAtAll() {
    // The null-tolerance difference, as its own row. Without `@NotNull` the
    // `email` violation simply does not exist, the field name never reaches
    // the message, and "field names are the promise" quietly stops being
    // true — with every other assertion still green.
    String error = (String) HttpProbe.post(port, "/probe/validated", "{}").json().get("error");

    assertThat(error).contains("email");
  }

  @Test
  void aMalformedBodyIsOpaque() {
    // OPAQUE: V8 produced three different strings for three malformed bodies
    // and Jackson writes its own. Status, shape and path are the contract.
    HttpProbe response = HttpProbe.post(port, "/probe/validated", "{");

    assertEnvelope(response, 400, "/probe/validated");
  }

  @Test
  void anUnsupportedContentTypeIsOpaque() {
    // OPAQUE for the same reason, one layer out: the refusal is the
    // framework's, and Express and Spring word it differently.
    HttpProbe response =
        HttpProbe.post(port, "/probe/validated", "not json", "text/plain");

    assertThat(response.status())
        .isEqualTo(HttpStatus.UNSUPPORTED_MEDIA_TYPE.value());
    assertEnvelope(response, 415, "/probe/validated");
  }
}
