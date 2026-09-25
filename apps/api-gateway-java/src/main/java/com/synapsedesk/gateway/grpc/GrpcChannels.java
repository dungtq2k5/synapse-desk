package com.synapsedesk.gateway.grpc;

import com.synapsedesk.gateway.config.GrpcProperties;
import io.grpc.ManagedChannel;
import io.grpc.netty.shaded.io.grpc.netty.NettyChannelBuilder;
import jakarta.annotation.PreDestroy;
import java.util.concurrent.TimeUnit;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import synapsedesk.auth.AuthServiceGrpc;
import synapsedesk.auth.UserServiceGrpc;

/**
 * One channel per PEER, plaintext — the same trust boundary the Node gateway
 * assumes (`credentials.createInsecure()`): every peer is reached inside the
 * cluster network, never across it.
 *
 * <p>`AuthService` and `UserService` share ONE channel: both are served by the
 * same auth-service process, at the same address, so a second channel would
 * be a second TCP connection to open for no separation gRPC does not already
 * give at the service level.
 *
 * <p>Only auth-service today; a peer added later is a bean added here, not a
 * pattern invented here — Spring's own channel builder is the whole
 * abstraction this skeleton needs.
 */
@Configuration
public class GrpcChannels {

  private ManagedChannel authChannel;

  /** The channel, as its own bean — both stubs below depend on it, so Spring orders it first. */
  @Bean
  ManagedChannel authServiceChannel(GrpcProperties grpc) {
    String[] hostPort = grpc.authServiceUrl().split(":", 2);
    authChannel =
        NettyChannelBuilder.forAddress(hostPort[0], Integer.parseInt(hostPort[1]))
            .usePlaintext()
            .build();

    return authChannel;
  }

  @Bean
  public AuthServiceGrpc.AuthServiceBlockingStub authServiceStub(ManagedChannel authServiceChannel) {
    return AuthServiceGrpc.newBlockingStub(authServiceChannel);
  }

  @Bean
  public UserServiceGrpc.UserServiceBlockingStub userServiceStub(ManagedChannel authServiceChannel) {
    return UserServiceGrpc.newBlockingStub(authServiceChannel);
  }

  @PreDestroy
  void shutdown() throws InterruptedException {
    if (authChannel != null) {
      authChannel.shutdown().awaitTermination(5, TimeUnit.SECONDS);
    }
  }
}
