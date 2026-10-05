package com.synapsedesk.gateway.grpc;

import com.synapsedesk.gateway.config.GrpcProperties;
import com.synapsedesk.gateway.metrics.GatewayMetrics;
import io.grpc.ManagedChannel;
import io.grpc.netty.shaded.io.grpc.netty.NettyChannelBuilder;
import jakarta.annotation.PreDestroy;
import java.util.concurrent.TimeUnit;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import synapsedesk.auth.AuthServiceGrpc;
import synapsedesk.auth.BillingServiceGrpc;
import synapsedesk.auth.DepartmentServiceGrpc;
import synapsedesk.auth.InvitationServiceGrpc;
import synapsedesk.auth.OrganizationServiceGrpc;
import synapsedesk.auth.OtpServiceGrpc;
import synapsedesk.auth.PlatformServiceGrpc;
import synapsedesk.auth.RoleServiceGrpc;
import synapsedesk.auth.SessionServiceGrpc;
import synapsedesk.auth.TwoFactorAuthServiceGrpc;
import synapsedesk.auth.UserServiceGrpc;
import synapsedesk.ingestion.AiLedgerServiceGrpc;
import synapsedesk.ingestion.DocumentServiceGrpc;
import synapsedesk.ingestion.IngestionPlatformServiceGrpc;
import synapsedesk.notification.NotificationServiceGrpc;
import synapsedesk.rag.RagServiceGrpc;
import synapsedesk.ticket.AiServiceGrpc;
import synapsedesk.ticket.AnalyticsServiceGrpc;
import synapsedesk.ticket.AssignmentServiceGrpc;
import synapsedesk.ticket.AuditServiceGrpc;
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
  private ManagedChannel ragChannel;

  /** Every peer's channel records its calls' duration; see {@link GrpcDurationInterceptor}. */
  private static ManagedChannel channel(
    String url,
    String peer,
    GatewayMetrics metrics
  ) {
    String[] hostPort = url.split(":", 2);

    return NettyChannelBuilder.forAddress(
      hostPort[0],
      Integer.parseInt(hostPort[1])
    )
      .usePlaintext()
      .intercept(new GrpcDurationInterceptor(peer, metrics))
      .build();
  }

  /** The channel, as its own bean — both stubs below depend on it, so Spring orders it first. */
  @Bean
  ManagedChannel authServiceChannel(
    GrpcProperties grpc,
    GatewayMetrics metrics
  ) {
    authChannel = channel(grpc.authServiceUrl(), "auth-service", metrics);

    return authChannel;
  }

  @Bean
  ManagedChannel ticketServiceChannel(
    GrpcProperties grpc,
    GatewayMetrics metrics
  ) {
    ticketChannel = channel(grpc.ticketServiceUrl(), "ticket-service", metrics);

    return ticketChannel;
  }

  @Bean
  ManagedChannel ingestionServiceChannel(
    GrpcProperties grpc,
    GatewayMetrics metrics
  ) {
    ingestionChannel = channel(
      grpc.ingestionServiceUrl(),
      "ingestion-service",
      metrics
    );

    return ingestionChannel;
  }

  @Bean
  ManagedChannel notificationServiceChannel(
    GrpcProperties grpc,
    GatewayMetrics metrics
  ) {
    notificationChannel = channel(
      grpc.notificationServiceUrl(),
      "notification-service",
      metrics
    );

    return notificationChannel;
  }

  @Bean
  ManagedChannel ragServiceChannel(
    GrpcProperties grpc,
    GatewayMetrics metrics
  ) {
    ragChannel = channel(grpc.ragServiceUrl(), "rag-service", metrics);

    return ragChannel;
  }

  @Bean
  public AuthServiceGrpc.AuthServiceBlockingStub authServiceStub(
    ManagedChannel authServiceChannel
  ) {
    return AuthServiceGrpc.newBlockingStub(authServiceChannel);
  }

  @Bean
  public UserServiceGrpc.UserServiceBlockingStub userServiceStub(
    ManagedChannel authServiceChannel
  ) {
    return UserServiceGrpc.newBlockingStub(authServiceChannel);
  }

  @Bean
  public BillingServiceGrpc.BillingServiceBlockingStub billingServiceStub(
    ManagedChannel authServiceChannel
  ) {
    return BillingServiceGrpc.newBlockingStub(authServiceChannel);
  }

  @Bean
  public PlatformServiceGrpc.PlatformServiceBlockingStub platformServiceStub(
    ManagedChannel authServiceChannel
  ) {
    return PlatformServiceGrpc.newBlockingStub(authServiceChannel);
  }

  @Bean
  public DepartmentServiceGrpc.DepartmentServiceBlockingStub departmentServiceStub(
    ManagedChannel authServiceChannel
  ) {
    return DepartmentServiceGrpc.newBlockingStub(authServiceChannel);
  }

  @Bean
  public RoleServiceGrpc.RoleServiceBlockingStub roleServiceStub(
    ManagedChannel authServiceChannel
  ) {
    return RoleServiceGrpc.newBlockingStub(authServiceChannel);
  }

  @Bean
  public InvitationServiceGrpc.InvitationServiceBlockingStub invitationServiceStub(
    ManagedChannel authServiceChannel
  ) {
    return InvitationServiceGrpc.newBlockingStub(authServiceChannel);
  }

  @Bean
  public OrganizationServiceGrpc.OrganizationServiceBlockingStub organizationServiceStub(
    ManagedChannel authServiceChannel
  ) {
    return OrganizationServiceGrpc.newBlockingStub(authServiceChannel);
  }

  @Bean
  public OtpServiceGrpc.OtpServiceBlockingStub otpServiceStub(
    ManagedChannel authServiceChannel
  ) {
    return OtpServiceGrpc.newBlockingStub(authServiceChannel);
  }

  @Bean
  public TwoFactorAuthServiceGrpc.TwoFactorAuthServiceBlockingStub twoFactorAuthServiceStub(
    ManagedChannel authServiceChannel
  ) {
    return TwoFactorAuthServiceGrpc.newBlockingStub(authServiceChannel);
  }

  @Bean
  public SessionServiceGrpc.SessionServiceBlockingStub sessionServiceStub(
    ManagedChannel authServiceChannel
  ) {
    return SessionServiceGrpc.newBlockingStub(authServiceChannel);
  }

  @Bean
  public AiServiceGrpc.AiServiceBlockingStub aiServiceStub(
    ManagedChannel ticketServiceChannel
  ) {
    return AiServiceGrpc.newBlockingStub(ticketServiceChannel);
  }

  @Bean
  public FeedbackServiceGrpc.FeedbackServiceBlockingStub feedbackServiceStub(
    ManagedChannel ticketServiceChannel
  ) {
    return FeedbackServiceGrpc.newBlockingStub(ticketServiceChannel);
  }

  @Bean
  public TicketServiceGrpc.TicketServiceBlockingStub ticketServiceStub(
    ManagedChannel ticketServiceChannel
  ) {
    return TicketServiceGrpc.newBlockingStub(ticketServiceChannel);
  }

  @Bean
  public MessageServiceGrpc.MessageServiceBlockingStub messageServiceStub(
    ManagedChannel ticketServiceChannel
  ) {
    return MessageServiceGrpc.newBlockingStub(ticketServiceChannel);
  }

  @Bean
  public AssignmentServiceGrpc.AssignmentServiceBlockingStub assignmentServiceStub(
    ManagedChannel ticketServiceChannel
  ) {
    return AssignmentServiceGrpc.newBlockingStub(ticketServiceChannel);
  }

  @Bean
  public AuditServiceGrpc.AuditServiceBlockingStub auditServiceStub(
    ManagedChannel ticketServiceChannel
  ) {
    return AuditServiceGrpc.newBlockingStub(ticketServiceChannel);
  }

  @Bean
  public AnalyticsServiceGrpc.AnalyticsServiceBlockingStub analyticsServiceStub(
    ManagedChannel ticketServiceChannel
  ) {
    return AnalyticsServiceGrpc.newBlockingStub(ticketServiceChannel);
  }

  @Bean
  public AiLedgerServiceGrpc.AiLedgerServiceBlockingStub aiLedgerServiceStub(
    ManagedChannel ingestionServiceChannel
  ) {
    return AiLedgerServiceGrpc.newBlockingStub(ingestionServiceChannel);
  }

  @Bean
  public DocumentServiceGrpc.DocumentServiceBlockingStub documentServiceStub(
    ManagedChannel ingestionServiceChannel
  ) {
    return DocumentServiceGrpc.newBlockingStub(ingestionServiceChannel);
  }

  @Bean
  public RagServiceGrpc.RagServiceBlockingStub ragServiceStub(
    ManagedChannel ragServiceChannel
  ) {
    return RagServiceGrpc.newBlockingStub(ragServiceChannel);
  }

  @Bean
  public IngestionPlatformServiceGrpc.IngestionPlatformServiceBlockingStub ingestionPlatformServiceStub(
    ManagedChannel ingestionServiceChannel
  ) {
    return IngestionPlatformServiceGrpc.newBlockingStub(
      ingestionServiceChannel
    );
  }

  @Bean
  public NotificationServiceGrpc.NotificationServiceBlockingStub notificationServiceStub(
    ManagedChannel notificationServiceChannel
  ) {
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
    if (ragChannel != null) {
      ragChannel.shutdown().awaitTermination(5, TimeUnit.SECONDS);
    }
  }
}
