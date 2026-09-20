package com.synapsedesk.gateway.error;

import static org.assertj.core.api.Assertions.assertThat;

import io.grpc.Status;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.http.HttpStatus;

/**
 * Gap 38: a peer's address never reaches a client.
 *
 * <p>The three codes grpc generates itself carry details naming the peer's
 * host and port. The Node gateway answers a fixed message for those in EVERY
 * environment, and the re-taken P3 capture is the text below — measured from
 * the built gateway with its peers down, not copied from a source file.
 */
class GrpcStatusMappingTest {

  @Test
  void aPeerThatIsDownTellsTheClientNothingAboutTheNetwork() {
    // The exact string the capture recorded on 2026-09-20.
    GrpcStatusMapping.ClientSafe safe =
        GrpcStatusMapping.resolve(
            Status.Code.UNAVAILABLE, "UNAVAILABLE: No connection established to localhost:59999");

    assertThat(safe.status()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
    assertThat(safe.message())
        .isEqualTo("A service this request depends on is unavailable. Try again shortly!");
    assertThat(safe.message()).doesNotContain("localhost");
    assertThat(safe.message()).doesNotContain("59999");
  }

  @ParameterizedTest(name = "{0} carries no peer detail")
  @CsvSource({"UNAVAILABLE", "DEADLINE_EXCEEDED", "CANCELLED"})
  void everyTransportClassCodeAnswersAFixedMessage(String code) {
    GrpcStatusMapping.ClientSafe safe =
        GrpcStatusMapping.resolve(Status.Code.valueOf(code), "peer at 10.1.2.3:5001 said no");

    assertThat(safe.message()).doesNotContain("10.1.2.3");
    assertThat(safe.message()).endsWith("!");
  }

  @ParameterizedTest(name = "{0} -> {1}")
  @CsvSource({
    "INVALID_ARGUMENT,400",
    "FAILED_PRECONDITION,400",
    "OUT_OF_RANGE,400",
    "UNAUTHENTICATED,401",
    "PERMISSION_DENIED,403",
    "NOT_FOUND,404",
    "ALREADY_EXISTS,409",
    "ABORTED,409",
    "RESOURCE_EXHAUSTED,429",
    "CANCELLED,408",
    "UNIMPLEMENTED,501",
    "UNAVAILABLE,503",
    "DEADLINE_EXCEEDED,504",
  })
  void theCodeTableIsTheNodeTable(String code, int status) {
    assertThat(GrpcStatusMapping.resolve(Status.Code.valueOf(code), "detail").status().value())
        .isEqualTo(status);
  }

  @Test
  void anUNKNOWNcodeIsA500RatherThanAGuess() {
    assertThat(GrpcStatusMapping.resolve(Status.Code.UNKNOWN, "x").status())
        .isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
  }

  @Test
  void aMarkedMessageIsForwardedWithItsStatus() {
    GrpcStatusMapping.ClientSafe safe =
        GrpcStatusMapping.resolve(Status.Code.INTERNAL, "[http:402] Your plan does not include this");

    assertThat(safe.status()).isEqualTo(HttpStatus.PAYMENT_REQUIRED);
    assertThat(safe.message()).isEqualTo("Your plan does not include this!");
  }

  @Test
  void aMarkerBeatsTheFixedTransportMessage() {
    // A service that deliberately wrote text for the user, while its own peer
    // happened to be down. The marker is the only channel for that, so it has
    // to win over the fixed message.
    GrpcStatusMapping.ClientSafe safe =
        GrpcStatusMapping.resolve(Status.Code.UNAVAILABLE, "[http:503] The mailbox is being moved");

    assertThat(safe.message()).isEqualTo("The mailbox is being moved!");
  }

  @Test
  void anImplausibleMarkerIsOrdinaryTextRatherThanAnInstruction() {
    // A message must not be able to choose its own status code by starting
    // with `[http:999]`.
    GrpcStatusMapping.ClientSafe safe =
        GrpcStatusMapping.resolve(Status.Code.NOT_FOUND, "[http:999] hello");

    assertThat(safe.status()).isEqualTo(HttpStatus.NOT_FOUND);
    assertThat(safe.message()).isEqualTo("[http:999] hello!");
  }
}
