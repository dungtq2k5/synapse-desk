package com.synapsedesk.gateway.common.grpc;

import com.synapsedesk.gateway.common.metrics.GatewayMetrics;
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
 * makes it the place to time them. A call site cannot forget it.
 *
 * <p><b>The {@code code} label is the status NAME</b>: {@code OK}, or the failure's
 * canonical name ({@code NOT_FOUND}, {@code UNAVAILABLE}, {@code DEADLINE_EXCEEDED}).
 * A deadline is {@code DEADLINE_EXCEEDED} whichever side enforced it, this channel's
 * own or the peer's. There is no {@code method} label: a series per RPC method would
 * multiply the series count for no question a dashboard asks.
 */
public final class GrpcDurationInterceptor implements ClientInterceptor {

  private final String peer;
  private final GatewayMetrics metrics;

  public GrpcDurationInterceptor(String peer, GatewayMetrics metrics) {
    this.peer = peer;
    this.metrics = metrics;
  }

  static String codeOf(Status status) {
    return status.getCode().name();
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
