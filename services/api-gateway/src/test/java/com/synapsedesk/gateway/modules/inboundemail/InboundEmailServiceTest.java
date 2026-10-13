package com.synapsedesk.gateway.modules.inboundemail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.synapsedesk.gateway.common.config.InboundEmailProperties;
import com.synapsedesk.gateway.modules.inboundemail.InboundEmail.RemoteAttachment;
import com.synapsedesk.gateway.modules.inboundemail.InboundEmailService.AcceptOptions;
import com.synapsedesk.gateway.modules.inboundemail.InboundEmailService.RemoteAttachmentSource;
import com.synapsedesk.gateway.modules.inboundemail.InboundPublisher.Reason;
import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import synapsedesk.auth.Common.OrgStatus;
import synapsedesk.auth.Organization.ResolveOrgByInboundTokenRequest;
import synapsedesk.auth.Organization.ResolveOrgByInboundTokenResponse;
import synapsedesk.auth.OrganizationServiceGrpc.OrganizationServiceBlockingStub;
import synapsedesk.auth.User.ResolveInboundSenderRequest;
import synapsedesk.auth.User.ResolveInboundSenderResponse;
import synapsedesk.auth.UserServiceGrpc.UserServiceBlockingStub;
import synapsedesk.notification.Notification.ResolveTicketByMessageIdRequest;
import synapsedesk.notification.Notification.ResolveTicketByMessageIdResponse;
import synapsedesk.notification.NotificationServiceGrpc.NotificationServiceBlockingStub;
import synapsedesk.ticket.Common.TicketPriority;
import synapsedesk.ticket.Common.TicketResponse;
import synapsedesk.ticket.Common.TicketSource;
import synapsedesk.ticket.Common.TicketStatus;
import synapsedesk.ticket.Message.CreateMessageRequest;
import synapsedesk.ticket.Message.IngestAttachmentRequest;
import synapsedesk.ticket.Message.IngestAttachmentResponse;
import synapsedesk.ticket.MessageServiceGrpc.MessageServiceBlockingStub;
import synapsedesk.ticket.Ticket.CreateTicketRequest;
import synapsedesk.ticket.Ticket.GetTicketByNumberRequest;
import synapsedesk.ticket.Ticket.TicketStatusActionRequest;
import synapsedesk.ticket.TicketServiceGrpc.TicketServiceBlockingStub;

/**
 * {@link InboundEmailService#accept}: the order routing runs in, what each exit
 * does and does not call, and what is written.
 *
 * <p>The peers are mocked stubs, so these rows assert on the calls themselves —
 * which peer was asked, with what, and in what order. The wire (metadata, the
 * counter, the HTTP status) is the contract suite's.
 *
 * <p><b>The failure the loop guards prevent reaches somebody else's inbox</b>,
 * which is why they are rows and not comments: an auto-responder on the other end
 * of a refused address plus a courtesy reply from us is an exchange with no upper
 * bound, and every message in it is real mail somebody receives.
 */
class InboundEmailServiceTest {

  private static final String TOKEN = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
  private static final String ORGANIZATION =
    "99999999-9999-4999-8999-999999999999";
  private static final String SENDER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  private static final String TICKET = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  private static final String SECRET = "reply-token-secret-for-this-test";
  private static final String OWN = "support@synapsedesk.test";

  private OrganizationServiceBlockingStub organizations;
  private UserServiceBlockingStub users;
  private TicketServiceBlockingStub tickets;
  private MessageServiceBlockingStub messages;
  private NotificationServiceBlockingStub notifications;
  private InboundPublisher publisher;
  private InboundEmailService service;

  @BeforeEach
  void setUp() {
    organizations = stub(OrganizationServiceBlockingStub.class);
    users = stub(UserServiceBlockingStub.class);
    tickets = stub(TicketServiceBlockingStub.class);
    messages = stub(MessageServiceBlockingStub.class);
    notifications = stub(NotificationServiceBlockingStub.class);
    publisher = mock(InboundPublisher.class);
    service = new InboundEmailService(
      organizations,
      users,
      tickets,
      messages,
      notifications,
      new InboundEmailProperties(
        SECRET,
        "inbound.test",
        OWN,
        "whsec_x",
        "re_key",
        "https://api.resend.test"
      ),
      publisher
    );
  }

  /** A stub whose deadline and interceptors come back as itself, so the mock sees the call. */
  private static <S extends io.grpc.stub.AbstractStub<S>> S stub(
    Class<S> type
  ) {
    S mocked = mock(type);
    when(mocked.withDeadlineAfter(anyLong(), any())).thenReturn(mocked);
    when(mocked.withInterceptors(any())).thenReturn(mocked);

    return mocked;
  }

  // ------------------------------------------------------------- fixtures

  private static String address(String suffix) {
    return "support+" + TOKEN + suffix + "@inbound.test";
  }

  private static InboundEmail mail(
    String to,
    String from,
    String subject,
    String text,
    String messageId,
    String inReplyTo,
    List<String> references,
    Map<String, String> headers,
    List<String> dropped,
    List<RemoteAttachment> remote
  ) {
    return new InboundEmail(
      messageId,
      to,
      from,
      null,
      subject,
      text,
      null,
      inReplyTo,
      references,
      headers,
      dropped,
      remote,
      List.of(),
      null,
      "2026-10-01T09:00:00.000Z"
    );
  }

  private static InboundEmail mail() {
    return mail(
      address(""),
      "customer@acme.test",
      "Help",
      "Please help",
      "<m1@acme.test>",
      null,
      List.of(),
      null,
      List.of(),
      List.of()
    );
  }

  private static InboundEmail with(
    String to,
    String from,
    Map<String, String> headers
  ) {
    return mail(
      to,
      from,
      "Help",
      "Please help",
      "<m1@acme.test>",
      null,
      List.of(),
      headers,
      List.of(),
      List.of()
    );
  }

  private static InboundEmail replying(
    String inReplyTo,
    List<String> references
  ) {
    return mail(
      address(""),
      "customer@acme.test",
      "Re: Help",
      "More detail",
      "<m2@acme.test>",
      inReplyTo,
      references,
      null,
      List.of(),
      List.of()
    );
  }

  private static InboundEmail withAttachments(
    List<String> dropped,
    List<RemoteAttachment> remote
  ) {
    return mail(
      address(""),
      "customer@acme.test",
      "Help",
      "See attached",
      "<m3@acme.test>",
      "<ours@synapsedesk.test>",
      List.of(),
      null,
      dropped,
      remote
    );
  }

  private static RemoteAttachment file(String id, String name, long size) {
    return new RemoteAttachment(id, name, "image/png", size);
  }

  private void tenant(OrgStatus status, long planBytes) {
    ResolveOrgByInboundTokenResponse.Builder tenant =
      ResolveOrgByInboundTokenResponse.newBuilder()
        .setOrganizationId(ORGANIZATION)
        .setStatus(status)
        .setMaxAttachmentBytes(planBytes);
    when(organizations.resolveOrgByInboundToken(any())).thenReturn(
      tenant.build()
    );
  }

  private void activeTenant() {
    tenant(OrgStatus.ORG_STATUS_ACTIVE, 10_000_000);
  }

  private void admittedSender() {
    when(users.resolveInboundSender(any())).thenReturn(
      ResolveInboundSenderResponse.newBuilder().setUserId(SENDER).build()
    );
  }

  private void routable() {
    activeTenant();
    admittedSender();
  }

  private static TicketResponse ticket(TicketStatus status) {
    return TicketResponse.newBuilder().setId(TICKET).setStatus(status).build();
  }

  private void repliesTo(String providerMessageId) {
    when(notifications.resolveTicketByMessageId(any())).thenAnswer(call -> {
      ResolveTicketByMessageIdRequest request = call.getArgument(0);
      return request.getProviderMessageId().equals(providerMessageId)
        ? ResolveTicketByMessageIdResponse.newBuilder()
            .setTicketId(TICKET)
            .build()
        : ResolveTicketByMessageIdResponse.getDefaultInstance();
    });
  }

  private CreateMessageRequest appended() {
    ArgumentCaptor<CreateMessageRequest> sent = ArgumentCaptor.forClass(
      CreateMessageRequest.class
    );
    verify(messages).createMessage(sent.capture());

    return sent.getValue();
  }

  private CreateTicketRequest created() {
    ArgumentCaptor<CreateTicketRequest> sent = ArgumentCaptor.forClass(
      CreateTicketRequest.class
    );
    verify(tickets).createTicket(sent.capture());

    return sent.getValue();
  }

  private static StatusRuntimeException failure(Status status) {
    return status.asRuntimeException();
  }

  private void noPeerWasCalled() {
    verifyNoInteractions(
      organizations,
      users,
      tickets,
      messages,
      notifications,
      publisher
    );
  }

  /** The reply token notification-service would put in a Reply-To: independent of the parser. */
  private static String replyToken(long number) throws Exception {
    Mac hmac = Mac.getInstance("HmacSHA256");
    hmac.init(
      new SecretKeySpec(SECRET.getBytes(StandardCharsets.UTF_8), "HmacSHA256")
    );
    String mac = HexFormat.of()
      .formatHex(
        hmac.doFinal(
          (ORGANIZATION + ":" + number).getBytes(StandardCharsets.UTF_8)
        )
      )
      .substring(0, 12);

    return Long.toString(number, 36) + "-" + mac;
  }

  // ------------------------------------------------------- 0. loop guards

  @Test
  void mailFromOurOwnAddressIsDroppedBeforeAnyPeerIsCalled() {
    for (String from : List.of(OWN, "SUPPORT@SynapseDesk.TEST")) {
      assertThat(
        service.accept(with(address(""), from, null), AcceptOptions.none())
      ).isEqualTo(InboundOutcome.SELF_ADDRESSED);
    }

    noPeerWasCalled();
  }

  // ------------------------------------------------- 1. the tenant

  @Test
  void anAddressThatIsNotATenantAddressIsUnroutableWithNoLookup() {
    var outcome = service.accept(
      with("support@inbound.test", "customer@acme.test", null),
      AcceptOptions.none()
    );

    assertThat(outcome).isEqualTo(InboundOutcome.UNROUTABLE_ADDRESS);
    noPeerWasCalled();
  }

  @Test
  void aTokenNoTenantOwnsIsUnroutableAfterExactlyOneLookupAndNeverRepliesToTheSender() {
    when(organizations.resolveOrgByInboundToken(any())).thenReturn(
      ResolveOrgByInboundTokenResponse.getDefaultInstance()
    );

    assertThat(service.accept(mail(), AcceptOptions.none())).isEqualTo(
      InboundOutcome.UNROUTABLE_ADDRESS
    );

    ArgumentCaptor<ResolveOrgByInboundTokenRequest> lookup =
      ArgumentCaptor.forClass(ResolveOrgByInboundTokenRequest.class);
    verify(organizations, times(1)).resolveOrgByInboundToken(lookup.capture());
    assertThat(lookup.getValue().getInboundToken()).isEqualTo(TOKEN);
    verifyNoInteractions(users, tickets, messages, notifications);
    // Backscatter: `From` is authenticated by nothing, and there is no tenant.
    verifyNoInteractions(publisher);
  }

  @Test
  void aTenantThatIsNotActiveIsDroppedBeforeItsSenderIsResolved() {
    for (OrgStatus status : List.of(
      OrgStatus.ORG_STATUS_FROZEN,
      OrgStatus.ORG_STATUS_SUSPENDED_PAST_DUE,
      OrgStatus.ORG_STATUS_PENDING_ONBOARDING,
      OrgStatus.ORG_STATUS_UNSPECIFIED
    )) {
      tenant(status, 10_000_000);

      assertThat(service.accept(mail(), AcceptOptions.none())).isEqualTo(
        InboundOutcome.TENANT_INACTIVE
      );
    }

    verifyNoInteractions(users, tickets, messages, notifications);
    verify(publisher, times(4)).rejected(
      ORGANIZATION,
      "customer@acme.test",
      Reason.UNROUTABLE
    );
  }

  // ------------------------------------------------- 2. the sender

  @Test
  void aSenderTheTenantDoesNotAdmitIsRefusedAndRepliedToOnce() {
    activeTenant();
    when(users.resolveInboundSender(any())).thenReturn(
      ResolveInboundSenderResponse.getDefaultInstance()
    );

    assertThat(service.accept(mail(), AcceptOptions.none())).isEqualTo(
      InboundOutcome.SENDER_NOT_PERMITTED
    );

    verifyNoInteractions(tickets, messages, notifications);
    verify(publisher).rejected(
      ORGANIZATION,
      "customer@acme.test",
      Reason.SENDER_NOT_PERMITTED
    );
  }

  @Test
  void theSenderIsResolvedForTheTenantTheAddressNamedNotTheSendersDomain() {
    routable();
    when(tickets.createTicket(any())).thenReturn(
      ticket(TicketStatus.TICKET_STATUS_NEW)
    );

    service.accept(mail(), AcceptOptions.none());

    ArgumentCaptor<ResolveInboundSenderRequest> sent = ArgumentCaptor.forClass(
      ResolveInboundSenderRequest.class
    );
    verify(users).resolveInboundSender(sent.capture());
    assertThat(sent.getValue().getOrganizationId()).isEqualTo(ORGANIZATION);
    assertThat(sent.getValue().getEmail()).isEqualTo("customer@acme.test");
  }

  @Test
  void aMachineGeneratedMessageIsRefusedWithoutAReplyWhateverTheReason() {
    for (Map<String, String> headers : List.of(
      Map.of("auto-submitted", "auto-replied"),
      Map.of("precedence", "bulk")
    )) {
      tenant(OrgStatus.ORG_STATUS_FROZEN, 10_000_000);
      assertThat(
        service.accept(
          with(address(""), "robot@acme.test", headers),
          AcceptOptions.none()
        )
      ).isEqualTo(InboundOutcome.TENANT_INACTIVE);

      activeTenant();
      when(users.resolveInboundSender(any())).thenReturn(
        ResolveInboundSenderResponse.getDefaultInstance()
      );
      assertThat(
        service.accept(
          with(address(""), "robot@acme.test", headers),
          AcceptOptions.none()
        )
      ).isEqualTo(InboundOutcome.SENDER_NOT_PERMITTED);
    }

    verifyNoInteractions(publisher);
  }

  @Test
  void autoSubmittedNoIsOrdinaryMailAndStillGetsTheReply() {
    activeTenant();
    when(users.resolveInboundSender(any())).thenReturn(
      ResolveInboundSenderResponse.getDefaultInstance()
    );

    service.accept(
      with(address(""), "person@acme.test", Map.of("auto-submitted", "no")),
      AcceptOptions.none()
    );

    verify(publisher).rejected(
      ORGANIZATION,
      "person@acme.test",
      Reason.SENDER_NOT_PERMITTED
    );
  }

  // ------------------------------------------------- 3. a new ticket

  @Test
  void anAdmittedSenderOpensATicketAuthoredByThemKeyedByTheMessageId() {
    routable();
    when(tickets.createTicket(any())).thenReturn(
      ticket(TicketStatus.TICKET_STATUS_NEW)
    );
    InboundEmail email = mail(
      address(""),
      "customer@acme.test",
      "  The printer is on fire  ",
      "It really is.\n\nOn Tue, A wrote:\n> old",
      "  <abc@mail.acme.test>  ",
      null,
      List.of(),
      null,
      List.of(),
      List.of()
    );

    assertThat(service.accept(email, AcceptOptions.none())).isEqualTo(
      InboundOutcome.TICKET_CREATED
    );

    CreateTicketRequest sent = created();
    assertThat(sent.getTitle()).isEqualTo("The printer is on fire");
    assertThat(sent.getDescription()).isEqualTo("It really is.");
    assertThat(sent.getSource()).isEqualTo(TicketSource.TICKET_SOURCE_EMAIL);
    // UNSPECIFIED: no header states a priority, and the sender must not set their own.
    assertThat(sent.getPriority()).isEqualTo(
      TicketPriority.TICKET_PRIORITY_UNSPECIFIED
    );
    assertThat(sent.getAuthorId()).isEqualTo(SENDER);
    assertThat(sent.getInboundMessageId()).isEqualTo("<abc@mail.acme.test>");
    verifyNoInteractions(messages);
  }

  @Test
  void aShortenedBodySaysSoInTheTicketAndAFullOneDoesNot() {
    routable();
    when(tickets.createTicket(any())).thenReturn(
      ticket(TicketStatus.TICKET_STATUS_NEW)
    );
    InboundEmail whole = mail();
    InboundEmail cut = new InboundEmail(
      whole.messageId(),
      whole.to(),
      whole.from(),
      null,
      whole.subject(),
      whole.text(),
      null,
      null,
      List.of(),
      null,
      List.of(),
      List.of(),
      List.of(),
      null,
      whole.receivedAt(),
      true
    );

    service.accept(whole, AcceptOptions.none());
    service.accept(cut, AcceptOptions.none());

    ArgumentCaptor<CreateTicketRequest> sent = ArgumentCaptor.forClass(
      CreateTicketRequest.class
    );
    verify(tickets, times(2)).createTicket(sent.capture());
    assertThat(sent.getAllValues().get(0).getDescription()).isEqualTo(
      "Please help"
    );
    assertThat(sent.getAllValues().get(1).getDescription()).isEqualTo(
      "Please help\n\n---\nThis message was longer than 50000 characters and has been shortened."
    );
  }

  @Test
  void aBlankSubjectBecomesNoSubject() {
    routable();
    when(tickets.createTicket(any())).thenReturn(
      ticket(TicketStatus.TICKET_STATUS_NEW)
    );

    service.accept(
      mail(
        address(""),
        "customer@acme.test",
        "    ",
        "x",
        "<m@x>",
        null,
        List.of(),
        null,
        List.of(),
        List.of()
      ),
      AcceptOptions.none()
    );

    assertThat(created().getTitle()).isEqualTo("(no subject)");
  }

  @Test
  void aMailWithNoMessageIdIsStillKeyedByADigestOfTheMessageItself() {
    InboundEmail a = mail(
      address(""),
      "customer@acme.test",
      "Help",
      "one",
      null,
      null,
      List.of(),
      null,
      List.of(),
      List.of()
    );
    InboundEmail sameAgain = new InboundEmail(
      null,
      a.to(),
      a.from(),
      null,
      a.subject(),
      a.text(),
      null,
      null,
      List.of(),
      null,
      List.of(),
      List.of(),
      List.of(),
      null,
      "2027-01-01T00:00:00.000Z"
    );
    InboundEmail different = mail(
      address(""),
      "customer@acme.test",
      "Help",
      "two",
      null,
      null,
      List.of(),
      null,
      List.of(),
      List.of()
    );

    String key = InboundEmailService.idempotencyKeyFor(a);

    assertThat(key).matches("synthesized:[0-9a-f]{64}");
    // `receivedAt` describes the delivery, not the message: a redelivery must key the same.
    assertThat(InboundEmailService.idempotencyKeyFor(sameAgain)).isEqualTo(key);
    assertThat(InboundEmailService.idempotencyKeyFor(different)).isNotEqualTo(
      key
    );
  }

  @Test
  void aLoneSurrogateIsHashedAsJavaScriptHashesIt() {
    assertThat(InboundEmailService.wellFormed("a\ud800b")).isEqualTo("a�b");
    assertThat(InboundEmailService.wellFormed("a\udc00b")).isEqualTo("a�b");
    assertThat(InboundEmailService.wellFormed("😀")).isEqualTo("😀");
    assertThat(InboundEmailService.wellFormed("trailing\ud800")).isEqualTo(
      "trailing�"
    );
  }

  // ------------------------------------------------- 3. threading

  @Test
  void inReplyToThreadsOntoTheTicketItPointsAt() {
    routable();
    repliesTo("<ours@synapsedesk.test>");
    when(tickets.getTicket(any())).thenReturn(
      ticket(TicketStatus.TICKET_STATUS_OPEN)
    );

    assertThat(
      service.accept(
        replying("<ours@synapsedesk.test>", List.of()),
        AcceptOptions.none()
      )
    ).isEqualTo(InboundOutcome.MESSAGE_APPENDED);

    CreateMessageRequest sent = appended();
    assertThat(sent.getTicketId()).isEqualTo(TICKET);
    assertThat(sent.getContent()).isEqualTo("More detail");
    // A customer's reply is customer-visible by definition.
    assertThat(sent.getIsInternalNote()).isFalse();
    assertThat(sent.getInvokeAi()).isFalse();
    assertThat(sent.getInboundMessageId()).isEqualTo("<m2@acme.test>");
    verify(tickets, never()).createTicket(any());
    verify(tickets, never()).reopenTicket(any());
  }

  @Test
  void referencesAreTriedNewestFirstAfterInReplyToAndScopedToTheTenant() {
    routable();
    repliesTo("<r3>");
    when(tickets.getTicket(any())).thenReturn(
      ticket(TicketStatus.TICKET_STATUS_OPEN)
    );

    service.accept(
      replying("<irt>", List.of("<r1>", "<r2>", "<r3>")),
      AcceptOptions.none()
    );

    ArgumentCaptor<ResolveTicketByMessageIdRequest> asked =
      ArgumentCaptor.forClass(ResolveTicketByMessageIdRequest.class);
    verify(notifications, times(2)).resolveTicketByMessageId(asked.capture());
    assertThat(
      asked
        .getAllValues()
        .stream()
        .map(ResolveTicketByMessageIdRequest::getProviderMessageId)
    ).containsExactly("<irt>", "<r3>");
    assertThat(asked.getAllValues()).allSatisfy(request ->
      assertThat(request.getOrganizationId()).isEqualTo(ORGANIZATION)
    );
  }

  @Test
  void aLongReferencesChainCostsAtMostFiveLookupsAndBlanksAreSkipped() {
    routable();
    when(notifications.resolveTicketByMessageId(any())).thenReturn(
      ResolveTicketByMessageIdResponse.getDefaultInstance()
    );
    when(tickets.createTicket(any())).thenReturn(
      ticket(TicketStatus.TICKET_STATUS_NEW)
    );
    List<String> references = new ArrayList<>();
    for (int i = 1; i <= 20; i++) references.add("<r" + i + ">");
    references.add(1, "   ");

    service.accept(replying("<irt>", references), AcceptOptions.none());

    verify(
      notifications,
      times(InboundEmailService.MAX_THREAD_LOOKUPS)
    ).resolveTicketByMessageId(any());
    verify(tickets).createTicket(any());
  }

  @Test
  void aHeaderThatPointsAtAMissingTicketFallsBackToANewOne() {
    routable();
    repliesTo("<ours>");
    when(tickets.getTicket(any())).thenThrow(failure(Status.NOT_FOUND));
    when(tickets.createTicket(any())).thenReturn(
      ticket(TicketStatus.TICKET_STATUS_NEW)
    );

    assertThat(
      service.accept(replying("<ours>", List.of()), AcceptOptions.none())
    ).isEqualTo(InboundOutcome.TICKET_CREATED);
  }

  @Test
  void aClosedTicketIsReopenedThroughTheTransitionBeforeTheReplyIsWritten() {
    routable();
    repliesTo("<ours>");
    when(tickets.getTicket(any())).thenReturn(
      ticket(TicketStatus.TICKET_STATUS_CLOSED)
    );

    service.accept(replying("<ours>", List.of()), AcceptOptions.none());

    InOrder order = inOrder(tickets, messages);
    ArgumentCaptor<TicketStatusActionRequest> reopen = ArgumentCaptor.forClass(
      TicketStatusActionRequest.class
    );
    order.verify(tickets).reopenTicket(reopen.capture());
    order.verify(messages).createMessage(any());
    assertThat(reopen.getValue().getTicketId()).isEqualTo(TICKET);
    assertThat(reopen.getValue().getReason()).isEqualTo(
      "Reopened by an inbound email reply"
    );
  }

  @Test
  void aVerifiedReplyTokenThreadsByNumberAndTheHeadersAreNotConsulted()
    throws Exception {
    routable();
    when(tickets.getTicketByNumber(any())).thenReturn(
      ticket(TicketStatus.TICKET_STATUS_OPEN)
    );
    InboundEmail email = mail(
      address("." + replyToken(42)),
      "customer@acme.test",
      "Re",
      "reply",
      "<m@x>",
      "<irt>",
      List.of("<r1>"),
      null,
      List.of(),
      List.of()
    );

    assertThat(service.accept(email, AcceptOptions.none())).isEqualTo(
      InboundOutcome.MESSAGE_APPENDED
    );

    ArgumentCaptor<GetTicketByNumberRequest> asked = ArgumentCaptor.forClass(
      GetTicketByNumberRequest.class
    );
    verify(tickets).getTicketByNumber(asked.capture());
    assertThat(asked.getValue().getTicketNumber()).isEqualTo(42);
    verify(tickets, never()).getTicket(any());
    verifyNoInteractions(notifications);
  }

  @Test
  void aTokenForAnotherTenantOrAForgedOneOpensANewTicketNotAThread()
    throws Exception {
    routable();
    repliesTo("<ours>");
    when(tickets.getTicket(any())).thenReturn(
      ticket(TicketStatus.TICKET_STATUS_OPEN)
    );
    when(tickets.createTicket(any())).thenReturn(
      ticket(TicketStatus.TICKET_STATUS_NEW)
    );
    String forged = replyToken(42).replaceAll("[0-9a-f]$", "0");
    String valid = replyToken(42);
    String tampered = valid.equals(forged)
      ? valid.replaceAll("[0-9a-f]$", "1")
      : forged;

    assertThat(
      service.accept(
        mail(
          address("." + tampered),
          "customer@acme.test",
          "Re",
          "reply",
          "<m@x>",
          "<ours>",
          List.of(),
          null,
          List.of(),
          List.of()
        ),
        AcceptOptions.none()
      )
    ).isEqualTo(InboundOutcome.TICKET_CREATED);

    verify(tickets, never()).getTicketByNumber(any());
    // A token was present, so a header that WOULD resolve a ticket is not consulted.
    verifyNoInteractions(notifications);
  }

  @Test
  void aVerifiedTokenWhoseTicketIsGoneCreatesANewTicketRatherThanDiscardTheMessage()
    throws Exception {
    routable();
    when(tickets.getTicketByNumber(any())).thenThrow(failure(Status.NOT_FOUND));
    when(tickets.createTicket(any())).thenReturn(
      ticket(TicketStatus.TICKET_STATUS_NEW)
    );

    assertThat(
      service.accept(
        mail(
          address("." + replyToken(7)),
          "customer@acme.test",
          "Re",
          "reply",
          "<m@x>",
          null,
          List.of(),
          null,
          List.of(),
          List.of()
        ),
        AcceptOptions.none()
      )
    ).isEqualTo(InboundOutcome.TICKET_CREATED);
  }

  // ------------------------------------------------- idempotency & failure

  @Test
  void aRedeliveredNewTicketIsADuplicateNotAnError() {
    routable();
    when(tickets.createTicket(any())).thenThrow(failure(Status.ALREADY_EXISTS));

    assertThat(service.accept(mail(), AcceptOptions.none())).isEqualTo(
      InboundOutcome.DUPLICATE
    );
  }

  @Test
  void aRedeliveredReplyIsADuplicateToo() {
    routable();
    repliesTo("<ours>");
    when(tickets.getTicket(any())).thenReturn(
      ticket(TicketStatus.TICKET_STATUS_OPEN)
    );
    when(messages.createMessage(any())).thenThrow(
      failure(Status.ALREADY_EXISTS)
    );

    assertThat(
      service.accept(replying("<ours>", List.of()), AcceptOptions.none())
    ).isEqualTo(InboundOutcome.DUPLICATE);
  }

  @Test
  void anyOtherFailureIsNotSwallowedBecauseA200WouldLoseTheMail() {
    routable();
    when(tickets.createTicket(any())).thenThrow(failure(Status.UNAVAILABLE));

    assertThatThrownBy(() ->
      service.accept(mail(), AcceptOptions.none())
    ).isInstanceOfSatisfying(StatusRuntimeException.class, thrown ->
      assertThat(thrown.getStatus().getCode()).isEqualTo(
        Status.Code.UNAVAILABLE
      )
    );
  }

  @Test
  void aTenantLookupThatFailsIsNotAnUnroutableAddress() {
    when(organizations.resolveOrgByInboundToken(any())).thenThrow(
      failure(Status.UNAVAILABLE)
    );

    assertThatThrownBy(() ->
      service.accept(mail(), AcceptOptions.none())
    ).isInstanceOf(StatusRuntimeException.class);
    verifyNoInteractions(publisher);
  }

  // ------------------------------------------------- attachments

  private AcceptOptions sources(
    Map<String, RemoteAttachmentSource> sources,
    AtomicInteger fetched
  ) {
    return new AcceptOptions(() -> {
      fetched.incrementAndGet();
      return sources;
    });
  }

  private static RemoteAttachmentSource at(String url) {
    return new RemoteAttachmentSource(url, Instant.now().plusSeconds(3600));
  }

  private void ingests() {
    when(messages.ingestAttachment(any())).thenAnswer(call -> {
      IngestAttachmentRequest request = call.getArgument(0);
      return IngestAttachmentResponse.newBuilder()
        .setObjectPath("pending/" + request.getFileName())
        .build();
    });
  }

  private void threadedTicket() {
    routable();
    repliesTo("<ours@synapsedesk.test>");
    when(tickets.getTicket(any())).thenReturn(
      ticket(TicketStatus.TICKET_STATUS_OPEN)
    );
  }

  @Test
  void anIngestedAttachmentTravelsOnTheMessageByItsObjectPath() {
    threadedTicket();
    ingests();
    AtomicInteger fetched = new AtomicInteger();

    service.accept(
      withAttachments(List.of(), List.of(file("a1", "shot.png", 1000))),
      sources(Map.of("a1", at("https://files.test/a1")), fetched)
    );

    CreateMessageRequest sent = appended();
    assertThat(sent.getAttachmentsList()).hasSize(1);
    assertThat(sent.getAttachments(0).getObjectPath()).isEqualTo(
      "pending/shot.png"
    );
    assertThat(sent.getAttachments(0).getFileName()).isEqualTo("shot.png");
    assertThat(sent.getContent()).isEqualTo("See attached");
    assertThat(fetched.get()).isEqualTo(1);
    ArgumentCaptor<IngestAttachmentRequest> ingest = ArgumentCaptor.forClass(
      IngestAttachmentRequest.class
    );
    verify(messages).ingestAttachment(ingest.capture());
    assertThat(ingest.getValue().getTicketId()).isEqualTo(TICKET);
    assertThat(ingest.getValue().getSourceUrl()).isEqualTo(
      "https://files.test/a1"
    );
    assertThat(ingest.getValue().getFileSizeBytes()).isEqualTo(1000);
  }

  @Test
  void everyRefusedFileIsNamedInANoteOnTheMessageAndNeverFailsTheMail() {
    threadedTicket();
    when(messages.ingestAttachment(any())).thenAnswer(call -> {
      IngestAttachmentRequest request = call.getArgument(0);
      if (request.getFileName().equals("bad.png")) throw failure(
        Status.UNAVAILABLE
      );
      return IngestAttachmentResponse.newBuilder()
        .setObjectPath("pending/" + request.getFileName())
        .build();
    });
    Map<String, RemoteAttachmentSource> sources = Map.of(
      "ok",
      at("https://files.test/ok"),
      "bad",
      at("https://files.test/bad"),
      "old",
      new RemoteAttachmentSource(
        "https://files.test/old",
        Instant.now().minusSeconds(5)
      )
    );

    var outcome = service.accept(
      withAttachments(
        List.of("mapper-refused.exe"),
        List.of(
          file("ok", "ok.png", 10),
          file("bad", "bad.png", 10),
          file("old", "old.png", 10),
          file("huge", "huge.png", 99_999_999),
          file("nosource", "nosource.png", 10)
        )
      ),
      sources(sources, new AtomicInteger())
    );

    assertThat(outcome).isEqualTo(InboundOutcome.MESSAGE_APPENDED);
    CreateMessageRequest sent = appended();
    assertThat(sent.getAttachmentsList())
      .extracting(a -> a.getFileName())
      .containsExactly("ok.png");
    assertThat(sent.getContent()).startsWith(
      "See attached\n\n---\nAttachments were not accepted by email: mapper-refused.exe, "
    );
    for (String name : List.of(
      "bad.png",
      "old.png",
      "huge.png",
      "nosource.png"
    )) {
      assertThat(sent.getContent()).contains(name);
    }
    assertThat(sent.getContent())
      .doesNotContain("ok.png,")
      .doesNotContain(", ok.png");
  }

  @Test
  void theTenantsLimitsNarrowWhatIsAccepted() {
    // 2 per message and 500 bytes per file, from the tenant's override and the plan grant.
    when(organizations.resolveOrgByInboundToken(any())).thenReturn(
      ResolveOrgByInboundTokenResponse.newBuilder()
        .setOrganizationId(ORGANIZATION)
        .setStatus(OrgStatus.ORG_STATUS_ACTIVE)
        .setMaxAttachmentBytes(10_000_000)
        .setMaxAttachmentBytesOverride(500)
        .setMaxAttachmentsPerMessageOverride(2)
        .build()
    );
    admittedSender();
    repliesTo("<ours@synapsedesk.test>");
    when(tickets.getTicket(any())).thenReturn(
      ticket(TicketStatus.TICKET_STATUS_OPEN)
    );
    ingests();
    Map<String, RemoteAttachmentSource> sources = Map.of(
      "a",
      at("https://files.test/a"),
      "b",
      at("https://files.test/b"),
      "c",
      at("https://files.test/c"),
      "d",
      at("https://files.test/d")
    );

    service.accept(
      withAttachments(
        List.of(),
        List.of(
          file("a", "a.png", 500),
          file("b", "b.png", 501),
          file("c", "c.png", 1),
          file("d", "d.png", 1)
        )
      ),
      sources(sources, new AtomicInteger())
    );

    CreateMessageRequest sent = appended();
    assertThat(sent.getAttachmentsList())
      .extracting(a -> a.getFileName())
      .containsExactly("a.png", "c.png");
    assertThat(sent.getContent()).endsWith("b.png, d.png");
  }

  @Test
  void aPlanGrantThatLostItsFieldRefusesRatherThanWidens() {
    tenant(OrgStatus.ORG_STATUS_ACTIVE, 0);
    admittedSender();
    repliesTo("<ours@synapsedesk.test>");
    when(tickets.getTicket(any())).thenReturn(
      ticket(TicketStatus.TICKET_STATUS_OPEN)
    );

    service.accept(
      withAttachments(List.of(), List.of(file("a", "a.png", 1))),
      sources(Map.of("a", at("https://files.test/a")), new AtomicInteger())
    );

    verify(messages, never()).ingestAttachment(any());
    assertThat(appended().getContent()).endsWith("a.png");
  }

  @Test
  void aMailThatOpensATicketNamesEveryRemoteAttachmentAsDroppedWithoutFetchingAnyUrl() {
    routable();
    when(tickets.createTicket(any())).thenReturn(
      ticket(TicketStatus.TICKET_STATUS_NEW)
    );
    AtomicInteger fetched = new AtomicInteger();
    InboundEmail email = mail(
      address(""),
      "customer@acme.test",
      "Help",
      "see attached",
      "<m@x>",
      null,
      List.of(),
      null,
      List.of("mapper.exe"),
      List.of(file("a", "a.png", 1), file("b", "b.png", 1))
    );

    assertThat(service.accept(email, sources(Map.of(), fetched))).isEqualTo(
      InboundOutcome.TICKET_CREATED
    );

    assertThat(created().getDescription()).isEqualTo(
      "see attached\n\n---\nAttachments were not accepted by email: mapper.exe, a.png, b.png"
    );
    assertThat(fetched.get()).isZero();
    verify(messages, never()).ingestAttachment(any());
  }

  @Test
  void theUrlListIsNeverSpentOnAMailWithNothingToFetch() {
    threadedTicket();
    AtomicInteger fetched = new AtomicInteger();

    service.accept(
      replying("<ours@synapsedesk.test>", List.of()),
      sources(Map.of(), fetched)
    );

    assertThat(fetched.get()).isZero();
  }

  @Test
  void noMoreThanTwoFilesAreIngestedAtOnce() throws Exception {
    threadedTicket();
    AtomicInteger inFlight = new AtomicInteger();
    AtomicInteger peak = new AtomicInteger();
    CountDownLatch twoStarted = new CountDownLatch(2);
    when(messages.ingestAttachment(any())).thenAnswer(call -> {
      int now = inFlight.incrementAndGet();
      peak.accumulateAndGet(now, Math::max);
      twoStarted.countDown();
      twoStarted.await(2, TimeUnit.SECONDS);
      Thread.sleep(50);
      inFlight.decrementAndGet();
      IngestAttachmentRequest request = call.getArgument(0);
      return IngestAttachmentResponse.newBuilder()
        .setObjectPath("pending/" + request.getFileName())
        .build();
    });
    Map<String, RemoteAttachmentSource> sources = Map.of(
      "a",
      at("https://f.test/a"),
      "b",
      at("https://f.test/b"),
      "c",
      at("https://f.test/c"),
      "d",
      at("https://f.test/d")
    );

    service.accept(
      withAttachments(
        List.of(),
        List.of(
          file("a", "a.png", 1),
          file("b", "b.png", 1),
          file("c", "c.png", 1),
          file("d", "d.png", 1)
        )
      ),
      sources(sources, new AtomicInteger())
    );

    // The literal, not the constant: comparing the peak to the thing under test
    // would pass for any value of it.
    assertThat(peak.get()).isEqualTo(2);
    // Order is the mail's own, whatever order the ingests finished in.
    assertThat(appended().getAttachmentsList())
      .extracting(a -> a.getFileName())
      .containsExactly("a.png", "b.png", "c.png", "d.png");
  }

  // ------------------------------------------------------------ deadlines

  @Test
  void everyPeerCallCarriesADeadlineAndTheIngestGetsTheWiderOne() {
    threadedTicket();
    ingests();

    service.accept(
      withAttachments(List.of(), List.of(file("a", "a.png", 1))),
      sources(Map.of("a", at("https://files.test/a")), new AtomicInteger())
    );

    // An unbounded call from a webhook is a hung request holding a socket the
    // sender will retry behind.
    for (var peer : List.of(organizations, users, tickets, notifications)) {
      verify(peer, org.mockito.Mockito.atLeastOnce()).withDeadlineAfter(
        eq(InboundEmailService.GRPC_DEADLINE_MS),
        eq(TimeUnit.MILLISECONDS)
      );
    }
    // Nested inside ticket-service's own 30 s deadline on storage.
    verify(messages).withDeadlineAfter(eq(35_000L), eq(TimeUnit.MILLISECONDS));
    verify(messages).withDeadlineAfter(
      eq(InboundEmailService.GRPC_DEADLINE_MS),
      eq(TimeUnit.MILLISECONDS)
    );
  }
}
