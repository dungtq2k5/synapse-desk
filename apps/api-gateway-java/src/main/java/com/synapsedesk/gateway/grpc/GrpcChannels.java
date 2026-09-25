package com.synapsedesk.gateway.grpc;

import com.synapsedesk.gateway.config.GrpcProperties;
import io.grpc.ManagedChannel;
import io.grpc.netty.shaded.io.grpc.netty.NettyChannelBuilder;
import jakarta.annotation.PreDestroy;
import java.util.concurrent.TimeUnit;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import synapsedesk.auth.AuthServiceGrpc;
import synapsedesk.auth.OtpServiceGrpc;
import synapsedesk.auth.UserServiceGrpc;
import synapsedesk.ticket.FeedbackServiceGrpc;
import synapsedesk.ticket.MessageServiceGrpc;
import synapsedesk.ticket.TicketServiceGrpc;

/**
 * One channel per PEER, plaintext — the same trust boundary the Node gateway
 * assumes (`credentials.createInsecure()`): every peer is reached inside the
 * cluster network, never across it.
 *
 * <p>`AuthService` and `UserService` share ONE channel: both are served by the
 * same auth-service process, at the same address, so a second channel would
 * be a second TCP connection to open for no separation gRPC does not already
 * give at the service level. `FeedbackService` is the first stub on a SECOND
 * peer, ticket-service — plan 84's `Feedback` module is the one that pays for
 * that channel, which `Chat` (also ticket-service) then reuses for free.
 */
@Configuration
public class GrpcChannels {

  private ManagedChannel authChannel;
  private ManagedChannel ticketChannel;

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
  ManagedChannel ticketServiceChannel(GrpcProperties grpc) {
    String[] hostPort = grpc.ticketServiceUrl().split(":", 2);
    ticketChannel =
        NettyChannelBuilder.forAddress(hostPort[0], Integer.parseInt(hostPort[1]))
            .usePlaintext()
            .build();

    return ticketChannel;
  }

  @Bean
  public AuthServiceGrpc.AuthServiceBlockingStub authServiceStub(ManagedChannel authServiceChannel) {
    return AuthServiceGrpc.newBlockingStub(authServiceChannel);
  }

  @Bean
  public UserServiceGrpc.UserServiceBlockingStub userServiceStub(ManagedChannel authServiceChannel) {
    return UserServiceGrpc.newBlockingStub(authServiceChannel);
  }

  @Bean
  public OtpServiceGrpc.OtpServiceBlockingStub otpServiceStub(ManagedChannel authServiceChannel) {
    return OtpServiceGrpc.newBlockingStub(authServiceChannel);
  }

  @Bean
  public FeedbackServiceGrpc.FeedbackServiceBlockingStub feedbackServiceStub(
      ManagedChannel ticketServiceChannel) {
    return FeedbackServiceGrpc.newBlockingStub(ticketServiceChannel);
  }

  @Bean
  public TicketServiceGrpc.TicketServiceBlockingStub ticketServiceStub(
      ManagedChannel ticketServiceChannel) {
    return TicketServiceGrpc.newBlockingStub(ticketServiceChannel);
  }

  @Bean
  public MessageServiceGrpc.MessageServiceBlockingStub messageServiceStub(
      ManagedChannel ticketServiceChannel) {
    return MessageServiceGrpc.newBlockingStub(ticketServiceChannel);
  }

  @PreDestroy
  void shutdown() throws InterruptedException {
    if (authChannel != null) {
      authChannel.shutdown().awaitTermination(5, TimeUnit.SECONDS);
    }
    if (ticketChannel != null) {
      ticketChannel.shutdown().awaitTermination(5, TimeUnit.SECONDS);
    }
  }
}
