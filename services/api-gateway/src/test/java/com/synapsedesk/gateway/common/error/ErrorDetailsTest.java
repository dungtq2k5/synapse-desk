package com.synapsedesk.gateway.common.error;

import static org.assertj.core.api.Assertions.assertThat;

import io.grpc.Status;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

/**
 * Details cross gRPC behind a marker `@synapsedesk/core` writes; the gateway
 * lifts them out of the message onto the envelope.
 */
class ErrorDetailsTest {

  /** What `withErrorDetails(message, details)` writes. */
  private static String marked(String json, String message) {
    String encoded = Base64.getUrlEncoder()
      .withoutPadding()
      .encodeToString(json.getBytes(StandardCharsets.UTF_8));
    return "[details:" + encoded + "] " + message;
  }

  @Test
  void liftsAnObjectAndLeavesTheText() {
    ErrorDetails.Lifted lifted = ErrorDetails.lift(
      marked("{\"organizationStatus\":\"FROZEN\"}", "Frozen")
    );

    assertThat(lifted.details()).isEqualTo(
      Map.of("organizationStatus", "FROZEN")
    );
    assertThat(lifted.message()).isEqualTo("Frozen");
  }

  @Test
  void leavesUnmarkedMidSentenceAndMalformedMarkersAsText() {
    for (String message : List.of(
      "No document with that id",
      "quoting [details:e30] mid-sentence",
      "[details:!!!] not base64url",
      marked("[1]", "an array"),
      marked("{", "not JSON")
    )) {
      ErrorDetails.Lifted lifted = ErrorDetails.lift(message);
      assertThat(lifted.details()).isNull();
      assertThat(lifted.message()).isEqualTo(message);
    }
  }

  @Test
  void ridesBehindTheStatusMarkerThroughTheMapping() {
    GrpcStatusMapping.ClientSafe safe = GrpcStatusMapping.resolve(
      Status.Code.FAILED_PRECONDITION,
      "[http:402] " +
        marked(
          "{\"overLimit\":[{\"dimension\":\"SEATS\",\"inUse\":11,\"allowed\":10}]}",
          "Too big"
        )
    );

    assertThat(safe.status()).isEqualTo(HttpStatus.PAYMENT_REQUIRED);
    assertThat(safe.message()).isEqualTo("Too big!");
    assertThat(safe.details()).isEqualTo(
      Map.of(
        "overLimit",
        List.of(Map.of("dimension", "SEATS", "inUse", 11, "allowed", 10))
      )
    );
  }

  @Test
  void anUnmarkedRefusalCarriesItsDetailsToo() {
    GrpcStatusMapping.ClientSafe safe = GrpcStatusMapping.resolve(
      Status.Code.PERMISSION_DENIED,
      marked("{\"organizationStatus\":\"FROZEN\"}", "Can't be opened")
    );

    assertThat(safe.status()).isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(safe.message()).isEqualTo("Can't be opened!");
    assertThat(safe.details()).containsEntry("organizationStatus", "FROZEN");
  }
}
