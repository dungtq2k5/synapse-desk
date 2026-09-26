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
import synapsedesk.auth.SessionServiceGrpc;
import synapsedesk.auth.UserServiceGrpc;
import synapsedesk.ingestion.AiLedgerServiceGrpc;
import synapsedesk.ingestion.DocumentServiceGrpc;
import synapsedesk.notification.NotificationServiceGrpc;
import synapsedesk.ticket.AnalyticsServiceGrpc;
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
 * peer, ticket-service — the `Feedback` module is the one that pays for
 * that channel, which `Chat` (also ticket-service) then reuses for free.
 */
@Configuration
public class GrpcChannels {

  private ManagedChannel authChannel;
  private ManagedChannel ticketChannel;
  private ManagedChannel ingestionChannel;
  private ManagedChannel notificationChannel;

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
  ManagedChannel ingestionServiceChannel(GrpcProperties grpc) {
    String[] hostPort = grpc.ingestionServiceUrl().split(":", 2);
    ingestionChannel =
        NettyChannelBuilder.forAddress(hostPort[0], Integer.parseInt(hostPort[1]))
            .usePlaintext()
            .build();

    return ingestionChannel;
  }

  @Bean
  ManagedChannel notificationServiceChannel(GrpcProperties grpc) {
    String[] hostPort = grpc.notificationServiceUrl().split(":", 2);
    notificationChannel =
        NettyChannelBuilder.forAddress(hostPort[0], Integer.parseInt(hostPort[1]))
            .usePlaintext()
            .build();

    return notificationChannel;
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
  public SessionServiceGrpc.SessionServiceBlockingStub sessionServiceStub(ManagedChannel authServiceChannel) {
    return SessionServiceGrpc.newBlockingStub(authServiceChannel);
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

  @Bean
  public AnalyticsServiceGrpc.AnalyticsServiceBlockingStub analyticsServiceStub(
      ManagedChannel ticketServiceChannel) {
    return AnalyticsServiceGrpc.newBlockingStub(ticketServiceChannel);
  }

  @Bean
  public AiLedgerServiceGrpc.AiLedgerServiceBlockingStub aiLedgerServiceStub(
      ManagedChannel ingestionServiceChannel) {
    return AiLedgerServiceGrpc.newBlockingStub(ingestionServiceChannel);
  }

  @Bean
  public DocumentServiceGrpc.DocumentServiceBlockingStub documentServiceStub(
      ManagedChannel ingestionServiceChannel) {
    return DocumentServiceGrpc.newBlockingStub(ingestionServiceChannel);
  }

  @Bean
  public NotificationServiceGrpc.NotificationServiceBlockingStub notificationServiceStub(
      ManagedChannel notificationServiceChannel) {
    return NotificationServiceGrpc.newBlockingStub(notificationServiceChannel);
  }

  @PreDestroy
  void shutdown() throws InterruptedException {
    if (authChannel != null) {
      authChannel.shutdown().awaitTermination(5, TimeUnit.SECONDS);
    }
    if (ticketChannel != null) {
      ticketChannel.shutdown().awaitTermination(5, TimeUnit.SECONDS);
    }
    if (ingestionChannel != null) {
      ingestionChannel.shutdown().awaitTermination(5, TimeUnit.SECONDS);
    }
    if (notificationChannel != null) {
      notificationChannel.shutdown().awaitTermination(5, TimeUnit.SECONDS);
    }
  }
}
