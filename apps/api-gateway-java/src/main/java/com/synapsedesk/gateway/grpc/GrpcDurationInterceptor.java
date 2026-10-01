package com.synapsedesk.gateway.grpc;

import com.synapsedesk.gateway.metrics.GatewayMetrics;
import io.grpc.CallOptions;
import io.grpc.Channel;
import io.grpc.ClientCall;
import io.grpc.ClientInterceptor;
import io.grpc.ForwardingClientCall.SimpleForwardingClientCall;
import io.grpc.ForwardingClientCallListener.SimpleForwardingClientCallListener;
import io.grpc.Metadata;
import io.grpc.MethodDescriptor;
import io.grpc.Status;
import java.time.Duration;

/**
 * Records {@code grpc_client_duration_seconds{peer, code}} for every call on one
 * peer's channel — the single place every call passes through, which is what
 * Node's {@code BaseGrpcClient.call} is for it. A call site cannot forget it.
 *
 * <p><b>The {@code code} label is Node's, quirks included, because a dashboard
 * reads it:</b> {@code OK} for success, the NUMERIC status code as a string for
 * a failure ({@code "14"}, not {@code UNAVAILABLE}), and {@code
 * DEADLINE_EXCEEDED} by name — Node's own timeout is the one failure it names.
 * A peer that itself answers status 4 is therefore {@code DEADLINE_EXCEEDED}
 * here and {@code "4"} there; the two are not distinguishable on this side.
 * There is no {@code method} label, as in Node.
 */
public final class GrpcDurationInterceptor implements ClientInterceptor {

  private final String peer;
  private final GatewayMetrics metrics;

  public GrpcDurationInterceptor(String peer, GatewayMetrics metrics) {
    this.peer = peer;
    this.metrics = metrics;
  }

  static String codeOf(Status status) {
    if (status.isOk()) return "OK";
    if (status.getCode() == Status.Code.DEADLINE_EXCEEDED) {
      return "DEADLINE_EXCEEDED";
    }

    return String.valueOf(status.getCode().value());
  }

  @Override
  public <Req, Res> ClientCall<Req, Res> interceptCall(
    MethodDescriptor<Req, Res> method,
    CallOptions options,
    Channel next
  ) {
    return new SimpleForwardingClientCall<>(next.newCall(method, options)) {
      @Override
      public void start(Listener<Res> listener, Metadata headers) {
        long started = System.nanoTime();
        super.start(
          new SimpleForwardingClientCallListener<>(listener) {
            @Override
            public void onClose(Status status, Metadata trailers) {
              metrics.grpcCall(
                peer,
                codeOf(status),
                Duration.ofNanos(System.nanoTime() - started)
              );
              super.onClose(status, trailers);
            }
          },
          headers
        );
      }
    };
  }
}
