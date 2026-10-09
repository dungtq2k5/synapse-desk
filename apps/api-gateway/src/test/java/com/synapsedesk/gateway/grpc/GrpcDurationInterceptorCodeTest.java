package com.synapsedesk.gateway.grpc;

import static org.assertj.core.api.Assertions.assertThat;

import io.grpc.Status;
import org.junit.jupiter.api.Test;

/** The {@code code} label: the status name, for success and every failure alike. */
class GrpcDurationInterceptorCodeTest {

  @Test
  void everyStatusIsLabelledByItsName() {
    assertThat(GrpcDurationInterceptor.codeOf(Status.OK)).isEqualTo("OK");
    assertThat(GrpcDurationInterceptor.codeOf(Status.NOT_FOUND)).isEqualTo(
      "NOT_FOUND"
    );
    assertThat(GrpcDurationInterceptor.codeOf(Status.UNAVAILABLE)).isEqualTo(
      "UNAVAILABLE"
    );
    assertThat(
      GrpcDurationInterceptor.codeOf(Status.DEADLINE_EXCEEDED)
    ).isEqualTo("DEADLINE_EXCEEDED");
  }
}
