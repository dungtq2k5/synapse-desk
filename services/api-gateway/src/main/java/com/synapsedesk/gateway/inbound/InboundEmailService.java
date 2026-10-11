package com.synapsedesk.gateway.inbound;

import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.auth.RequestOrigin;
import com.synapsedesk.gateway.config.InboundEmailProperties;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import com.synapsedesk.gateway.inbound.InboundEmail.RemoteAttachment;
import com.synapsedesk.gateway.inbound.InboundEmail.UploadedAttachment;
import com.synapsedesk.gateway.inbound.InboundPublisher.Reason;
import io.grpc.Metadata;
import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import io.grpc.stub.AbstractStub;
import io.grpc.stub.MetadataUtils;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import synapsedesk.auth.Common.OrgStatus;
import synapsedesk.auth.Organization.ResolveOrgByInboundTokenRequest;
import synapsedesk.auth.Organization.ResolveOrgByInboundTokenResponse;
import synapsedesk.auth.OrganizationServiceGrpc.OrganizationServiceBlockingStub;
import synapsedesk.auth.User.ResolveInboundSenderRequest;
import synapsedesk.auth.User.ResolveInboundSenderResponse;
import synapsedesk.auth.UserServiceGrpc.UserServiceBlockingStub;
import synapsedesk.notification.Notification.ResolveTicketByMessageIdRequest;
import synapsedesk.notification.NotificationServiceGrpc.NotificationServiceBlockingStub;
import synapsedesk.ticket.Common.TicketPriority;
import synapsedesk.ticket.Common.TicketResponse;
import synapsedesk.ticket.Common.TicketSource;
import synapsedesk.ticket.Common.TicketStatus;
import synapsedesk.ticket.Message.CreateMessageRequest;
import synapsedesk.ticket.Message.IngestAttachmentRequest;
import synapsedesk.ticket.Message.NewAttachment;
import synapsedesk.ticket.MessageServiceGrpc.MessageServiceBlockingStub;
import synapsedesk.ticket.Ticket.CreateTicketRequest;
import synapsedesk.ticket.Ticket.GetTicketByNumberRequest;
import synapsedesk.ticket.Ticket.GetTicketRequest;
import synapsedesk.ticket.Ticket.TicketStatusActionRequest;
import synapsedesk.ticket.TicketServiceGrpc.TicketServiceBlockingStub;

/**
 * The email adapter: {@code accept} turns one inbound mail into a ticket, a
 * message on one, or a refusal ({@link InboundOutcome}).
 *
 * <p><b>The gateway is the only component that knows what an email is.</b>
 * Address parsing, the reply-token HMAC, quoted history and the loop headers are
 * transport; the tenant, the sender and the ticket are RPCs to the services that
 * own them. ticket-service never learns that mail exists — it receives a ticket
 * with {@code source = EMAIL} and an idempotency key.
 *
 * <p><b>Order is fixed and each step gates the next: tenant, then sender, then
 * thread.</b> Resolving the tenant later would mean running the sender query
 * unscoped, which is the cross-tenant misroute the tenant token exists to
 * prevent.
 *
 * <p>An infrastructure failure is NEVER a 200: that would tell the provider the
 * mail was accepted and lose it, where a 5xx makes it retry and the dedup row
 * makes that retry safe. Only {@code ALREADY_EXISTS} — a redelivery — is
 * swallowed, as {@link InboundOutcome#DUPLICATE}.
 */
@Service
public class InboundEmailService {

  private static final Logger LOG = LoggerFactory.getLogger(
    InboundEmailService.class
  );

  /**
   * Attachments ingested at once for one mail.
   *
   * <p><b>Two, not one after another and not all at once.</b> Every file is a
   * fetch of up to {@link InboundLimits#MAX_ATTACHMENT_BYTES} inside ONE webhook
   * request, and a request that outlasts Resend's response timeout is redelivered
   * — re-ingesting every file. Sequential fetches stack the time; unbounded ones
   * would put a mail's whole attachment list on storage-service at once.
   */
  static final int INGEST_CONCURRENCY = 2;

  /**
   * How many thread headers are worth a lookup. {@code References} grows by one
   * entry per hop, so a long thread would otherwise make one email cost dozens of
   * RPCs — and the entry that matches is overwhelmingly the newest.
   */
  static final int MAX_THREAD_LOOKUPS = 5;

  /** {@code GRPC_DEADLINE_MS}: the standard deadline on a peer call. */
  static final long GRPC_DEADLINE_MS = 5_000;

  /** The attachment ingest, five seconds wider than ticket-service's own deadline on storage. */
  static final long INGEST_CALL_DEADLINE_MS =
    InboundLimits.INGEST_DEADLINE_MS + 5_000L;

  /** An unauthenticated caller: the sender is resolved FROM the mail, so nothing is known yet. */
  private static final RequestOrigin UNKNOWN_ORIGIN = new RequestOrigin("", "");

  /** Where an attachment can be downloaded from, and until when ({@code null} when unparseable). */
  public record RemoteAttachmentSource(String sourceUrl, Instant expiresAt) {}

  /** What {@code accept} needs from the transport beyond the mail itself. */
  public record AcceptOptions(
    Supplier<Map<String, RemoteAttachmentSource>> fetchAttachmentUrls
  ) {
    public static AcceptOptions none() {
      return new AcceptOptions(null);
    }
  }

  /** What ingest produced: paths for {@code createMessage}, and the names it refused. */
  private record IngestResult(
    List<UploadedAttachment> uploaded,
    List<String> dropped
  ) {}

  /** The attachment ceilings for one mail, platform and plan and tenant already applied. */
  private record Limits(long maxBytes, int maxPerMessage) {}

  /**
   * How routing ended. A discriminated result rather than a nullable one, so the
   * three ways a mail can be unroutable stay distinguishable: {@code accept}
   * turns each into its own drop.
   */
  private record Routing(
    InboundOutcome failure,
    String organizationId,
    String status,
    RequestContext context,
    Limits limits,
    boolean addressedToTicket,
    TicketResponse ticket
  ) {
    boolean ok() {
      return failure == null;
    }

    static Routing failed(
      InboundOutcome outcome,
      String organizationId,
      String status
    ) {
      return new Routing(
        outcome,
        organizationId,
        status,
        null,
        null,
        false,
        null
      );
    }
  }

  private final OrganizationServiceBlockingStub organizations;
  private final UserServiceBlockingStub users;
  private final TicketServiceBlockingStub tickets;
  private final MessageServiceBlockingStub messages;
  private final NotificationServiceBlockingStub notifications;
  private final InboundEmailProperties properties;
  private final InboundPublisher publisher;

  public InboundEmailService(
    OrganizationServiceBlockingStub organizations,
    UserServiceBlockingStub users,
    TicketServiceBlockingStub tickets,
    MessageServiceBlockingStub messages,
    NotificationServiceBlockingStub notifications,
    InboundEmailProperties properties,
    InboundPublisher publisher
  ) {
    this.organizations = organizations;
    this.users = users;
    this.tickets = tickets;
    this.messages = messages;
    this.notifications = notifications;
    this.properties = properties;
    this.publisher = publisher;
  }

  public InboundOutcome accept(InboundEmail payload, AcceptOptions options) {
    // ----------------------------------------------------------- 0. loop guards
    //
    // Before anything else, and unconditionally. A mail loop is the classic way an
    // email integration takes out a mailbox, and its blast radius is somebody
    // else's. Not even a rejection event: replying to ourselves IS the loop.
    if (LoopGuards.isSelfAddressed(payload.from(), properties.sender())) {
      LOG.warn("Inbound email ignored: it came from our own address");

      return InboundOutcome.SELF_ADDRESSED;
    }

    // ------------------------------------------------- 1-3. tenant, sender, thread
    //
    // One resolver, and the only place routing is decided. Anything that later
    // stores an attachment for this mail resolves the ticket through it too: two
    // resolutions that could disagree would put a customer's screenshot under one
    // ticket's prefix and attach it to another's message.
    Routing routing = resolveRouting(payload);

    if (!routing.ok()) {
      return drop(
        routing.failure(),
        payload,
        routing.organizationId(),
        routing.status()
      );
    }

    RequestContext context = routing.context();
    TicketResponse ticket = routing.ticket();

    // Ingest BEFORE the note is written, because the note names what ingest
    // refuses. On a mail that opens a ticket there is no message to attach to, so
    // every eligible attachment is named as dropped, alongside the ones the mapper
    // refused.
    IngestResult ingested =
      ticket != null
        ? ingestAttachments(payload, ticket, routing.limits(), context, options)
        : new IngestResult(
            List.of(),
            payload
              .remoteAttachments()
              .stream()
              .map(RemoteAttachment::fileName)
              .toList()
          );
    String storedBody = withTruncationNote(
      QuotedReply.toStoredBody(payload.text(), payload.html()),
      payload.bodyTruncated()
    );
    // The note is applied on both paths: a partial delivery with no record of the
    // missing half is worse than a total one.
    List<String> dropped = concat(
      payload.droppedAttachments(),
      ingested.dropped()
    );
    String inboundMessageId = idempotencyKeyFor(payload);

    try {
      if (ticket != null) {
        appendMessage(
          ticket,
          withAttachmentNote(storedBody, dropped),
          inboundMessageId,
          context,
          ingested.uploaded()
        );

        return InboundOutcome.MESSAGE_APPENDED;
      }
      // else, when the token verified but its ticket is gone: a new ticket is the
      // safe direction, because the alternative is discarding a customer's message.

      String body = withAttachmentNote(storedBody, dropped);
      String title = JsText.trim(payload.subject());

      authorised(tickets, context, GRPC_DEADLINE_MS).createTicket(
        CreateTicketRequest.newBuilder()
          .setTitle(title.isEmpty() ? "(no subject)" : title)
          .setDescription(body)
          .setSource(TicketSource.TICKET_SOURCE_EMAIL)
          // UNSPECIFIED, not a guess. No mail header states a priority, and
          // inferring one from "URGENT!!" in the subject would let the sender set
          // their own. ticket-service applies its own default.
          .setPriority(TicketPriority.TICKET_PRIORITY_UNSPECIFIED)
          // The resolved sender: the only identity here that survived verification.
          .setAuthorId(context.sub())
          .setInboundMessageId(inboundMessageId)
          .build()
      );

      return InboundOutcome.TICKET_CREATED;
    } catch (StatusRuntimeException failure) {
      // A redelivery. The provider retries by design, so this is the NORMAL path
      // rather than a fault: the first attempt already produced the ticket, and
      // the correct answer is 200 and a stop.
      if (failure.getStatus().getCode() == Status.Code.ALREADY_EXISTS) {
        return InboundOutcome.DUPLICATE;
      }

      throw failure;
    }
  }

  /**
   * The tenant, the sender and the ticket a message threads onto.
   *
   * <p><b>Read-only.</b> It may PROVISION a sender, but writes no ticket and no
   * message, so a caller that only needs the routing does not half-process an
   * unaccepted mail.
   */
  private Routing resolveRouting(InboundEmail payload) {
    InboundAddress address = InboundAddress.parse(payload.to());
    if (address == null) {
      return Routing.failed(InboundOutcome.UNROUTABLE_ADDRESS, null, null);
    }

    ResolveOrgByInboundTokenResponse tenant = authorised(
      organizations,
      UNKNOWN_ORIGIN,
      GRPC_DEADLINE_MS
    ).resolveOrgByInboundToken(
      ResolveOrgByInboundTokenRequest.newBuilder()
        .setInboundToken(address.tenantToken())
        .build()
    );

    if (!tenant.hasOrganizationId() || tenant.getOrganizationId().isEmpty()) {
      return Routing.failed(InboundOutcome.UNROUTABLE_ADDRESS, null, null);
    }
    String organizationId = tenant.getOrganizationId();

    // min(platform, plan, tenant), composed once for this mail. An absent OVERRIDE
    // means the tenant configured nothing and falls through to the layer above; an
    // absent PLAN GRANT is a wire that lost a non-optional field, and refuses
    // rather than widens.
    Limits limits = new Limits(
      Math.min(
        Math.min(
          InboundLimits.MAX_ATTACHMENT_BYTES,
          tenant.hasMaxAttachmentBytesOverride()
            ? tenant.getMaxAttachmentBytesOverride()
            : InboundLimits.MAX_ATTACHMENT_BYTES
        ),
        tenant.getMaxAttachmentBytes()
      ),
      Math.min(
        InboundLimits.MAX_ATTACHMENTS_PER_MESSAGE,
        tenant.hasMaxAttachmentsPerMessageOverride()
          ? tenant.getMaxAttachmentsPerMessageOverride()
          : InboundLimits.MAX_ATTACHMENTS_PER_MESSAGE
      )
    );

    if (tenant.getStatus() != OrgStatus.ORG_STATUS_ACTIVE) {
      return Routing.failed(
        InboundOutcome.TENANT_INACTIVE,
        organizationId,
        tenant.getStatus().name()
      );
    }

    ResolveInboundSenderRequest.Builder senderRequest =
      ResolveInboundSenderRequest.newBuilder()
        .setOrganizationId(organizationId)
        .setEmail(payload.from());
    if (payload.fromName() != null) senderRequest.setDisplayName(
      payload.fromName()
    );

    ResolveInboundSenderResponse sender = authorised(
      users,
      UNKNOWN_ORIGIN,
      GRPC_DEADLINE_MS
    ).resolveInboundSender(senderRequest.build());
    if (!sender.hasUserId() || sender.getUserId().isEmpty()) {
      return Routing.failed(
        InboundOutcome.SENDER_NOT_PERMITTED,
        organizationId,
        null
      );
    }

    if (sender.getCreated()) {
      LOG.info(
        "Provisioned an End User for {} in {}",
        safe(payload.from()),
        organizationId
      );
    }

    RequestContext context = new RequestContext(
      sender.getUserId(),
      organizationId,
      false,
      List.of(),
      List.of(),
      false,
      UNKNOWN_ORIGIN.ip(),
      UNKNOWN_ORIGIN.userAgent()
    );

    Long ticketNumber = ticketFromReplyToken(address, organizationId);
    if (ticketNumber != null) {
      // A reply token naming a ticket that does not resolve stays a reply: the
      // token said which thread this belongs to, and inventing a new one would
      // split the conversation. `accept` creates one anyway rather than discard
      // the message — see the note there.
      return new Routing(
        null,
        organizationId,
        null,
        context,
        limits,
        true,
        loadTicket(() ->
          authorised(tickets, context, GRPC_DEADLINE_MS).getTicketByNumber(
            GetTicketByNumberRequest.newBuilder()
              .setTicketNumber(ticketNumber)
              .build()
          )
        )
      );
    }

    if (address.ticketToken() == null) {
      String ticketId = ticketFromHeaders(payload, organizationId);
      if (ticketId != null) {
        TicketResponse ticket = loadTicket(() ->
          authorised(tickets, context, GRPC_DEADLINE_MS).getTicket(
            GetTicketRequest.newBuilder().setId(ticketId).build()
          )
        );
        if (ticket != null) {
          return new Routing(
            null,
            organizationId,
            null,
            context,
            limits,
            false,
            ticket
          );
        }
      }
    }

    // Routable, and it would CREATE a ticket rather than thread onto one.
    return new Routing(
      null,
      organizationId,
      null,
      context,
      limits,
      false,
      null
    );
  }

  /** A ticket fetch whose failure is "no such ticket", not an error. */
  private TicketResponse loadTicket(Supplier<TicketResponse> fetch) {
    try {
      return fetch.get();
    } catch (RuntimeException failure) {
      return null;
    }
  }

  /**
   * The write every threading path shares.
   *
   * <p><b>A CLOSED ticket is reopened through the transition, never a status
   * write</b>, the same rule {@code message:send} follows. Reopened first, so the
   * reply never lands on a ticket the state machine still considers finished.
   */
  private void appendMessage(
    TicketResponse ticket,
    String body,
    String inboundMessageId,
    RequestContext context,
    List<UploadedAttachment> attachments
  ) {
    if (ticket.getStatus() == TicketStatus.TICKET_STATUS_CLOSED) {
      authorised(tickets, context, GRPC_DEADLINE_MS).reopenTicket(
        TicketStatusActionRequest.newBuilder()
          .setTicketId(ticket.getId())
          // The first system-supplied reason in the tree: this transition has no
          // actor, so without it the history shows a closed ticket reopening itself.
          .setReason("Reopened by an inbound email reply")
          .build()
      );
    }

    CreateMessageRequest.Builder message = CreateMessageRequest.newBuilder()
      .setTicketId(ticket.getId())
      .setContent(body)
      // Never an internal note: a customer's reply is customer-visible by
      // definition, and the one thing found leaking was an internal note.
      .setIsInternalNote(false)
      .setInvokeAi(false)
      .setInboundMessageId(inboundMessageId);
    for (UploadedAttachment file : attachments) {
      message.addAttachments(
        NewAttachment.newBuilder()
          .setObjectPath(file.objectPath())
          .setFileName(file.fileName())
          .build()
      );
    }

    authorised(messages, context, GRPC_DEADLINE_MS).createMessage(
      message.build()
    );
  }

  /**
   * The ticket an {@code In-Reply-To} or {@code References} header points at.
   *
   * <p>{@code References} is tried after {@code In-Reply-To}, newest first:
   * clients drop and rewrite these more than the RFC suggests, and its LAST entry
   * is the message being answered, which is the one most likely to be ours.
   * Bounded by {@link #MAX_THREAD_LOOKUPS}.
   */
  private String ticketFromHeaders(
    InboundEmail payload,
    String organizationId
  ) {
    List<String> candidates = new ArrayList<>();
    candidates.add(payload.inReplyTo());
    List<String> references = new ArrayList<>(payload.references());
    Collections.reverse(references);
    candidates.addAll(references);

    List<String> lookups = candidates
      .stream()
      .map(value -> value == null ? "" : JsText.trim(value))
      .filter(value -> !value.isEmpty())
      .limit(MAX_THREAD_LOOKUPS)
      .toList();

    for (String providerMessageId : lookups) {
      var resolved = authorised(
        notifications,
        UNKNOWN_ORIGIN,
        GRPC_DEADLINE_MS
      ).resolveTicketByMessageId(
        ResolveTicketByMessageIdRequest.newBuilder()
          .setProviderMessageId(providerMessageId)
          .setOrganizationId(organizationId)
          .build()
      );

      if (resolved.hasTicketId() && !resolved.getTicketId().isEmpty()) {
        return resolved.getTicketId();
      }
    }

    return null;
  }

  /** The verified ticket number in the address, or {@code null}. */
  private Long ticketFromReplyToken(
    InboundAddress address,
    String organizationId
  ) {
    if (address.ticketToken() == null) return null;

    Long ticketNumber = TicketReplyToken.parse(
      address.ticketToken(),
      organizationId,
      properties.secret()
    );

    if (ticketNumber == null) {
      // A forged or stale token. Logged, then treated as no token at all — the
      // message opens a NEW ticket rather than being refused, because the sender
      // is legitimate and only the address was wrong.
      LOG.warn(
        "Inbound reply token failed verification for {}",
        organizationId
      );
    }

    return ticketNumber;
  }

  /**
   * The idempotency key — the {@code Message-ID}, or a digest when it had none.
   *
   * <p>A missing header is not a reason to skip the check: without a key, a retry
   * storm creates one ticket per attempt.
   *
   * <p><b>Every input is a property of the MESSAGE.</b> {@code receivedAt}
   * describes the delivery, so a key built from it could change between
   * redeliveries. The BODY is in the digest because sender, subject and second
   * are not enough to tell two genuinely different messages apart. {@code date}
   * is the sender's own header, absent for some clients, which the empty string
   * covers without changing shape.
   *
   * <p>Hashed as JavaScript hashes a string: a lone surrogate is encoded as
   * U+FFFD, not {@code ?}, so a redelivery that lands on the other gateway during
   * a cutover keys to the same row.
   */
  static String idempotencyKeyFor(InboundEmail payload) {
    String messageId =
      payload.messageId() == null ? "" : JsText.trim(payload.messageId());
    if (!messageId.isEmpty()) return messageId;

    String body =
      payload.text() != null
        ? payload.text()
        : payload.html() != null
          ? payload.html()
          : "";
    String joined = String.join(
      "\u0000",
      payload.from(),
      payload.subject(),
      payload.date() == null ? "" : payload.date(),
      body
    );

    try {
      byte[] digest = MessageDigest.getInstance("SHA-256").digest(
        wellFormed(joined).getBytes(StandardCharsets.UTF_8)
      );

      return "synthesized:" + HexFormat.of().formatHex(digest);
    } catch (NoSuchAlgorithmException failure) {
      throw new IllegalStateException("SHA-256 is not available", failure);
    }
  }

  /** {@code String.prototype.toWellFormed}: each lone surrogate becomes U+FFFD. */
  static String wellFormed(String value) {
    StringBuilder fixed = null;
    for (int i = 0; i < value.length(); i++) {
      char c = value.charAt(i);
      boolean lone = Character.isHighSurrogate(c)
        ? i + 1 >= value.length() ||
          !Character.isLowSurrogate(value.charAt(i + 1))
        : Character.isLowSurrogate(c) &&
          (i == 0 || !Character.isHighSurrogate(value.charAt(i - 1)));
      if (lone && fixed == null) {
        fixed = new StringBuilder(value.length()).append(value, 0, i);
      }
      if (fixed != null) fixed.append(lone ? '�' : c);
    }

    return fixed == null ? value : fixed.toString();
  }

  /**
   * Says the body was cut at {@link InboundLimits#MAX_INBOUND_BODY_LENGTH}, in the
   * body — visible to everyone on the thread for the same reason the
   * dropped-attachment note is: half a message that looks whole is worse than a
   * long one.
   */
  private static String withTruncationNote(String body, boolean truncated) {
    if (!truncated) return body;

    return (
      body +
      "\n\n---\nThis message was longer than " +
      InboundLimits.MAX_INBOUND_BODY_LENGTH +
      " characters and has been shortened."
    );
  }

  /**
   * Notes what was dropped, in the body. "Attachments silently vanish" is
   * something a customer finds before you do, so the omission is visible to
   * everyone on the thread rather than only in a log nobody reads.
   */
  private static String withAttachmentNote(String body, List<String> names) {
    if (names.isEmpty()) return body;

    return (
      body +
      "\n\n---\nAttachments were not accepted by email: " +
      String.join(", ", names)
    );
  }

  /**
   * Stores a reply's remote attachments through ticket-service and returns the
   * object paths for {@code createMessage}, plus the names of every file refused.
   *
   * <p>The rules, in order, with a name for everything refused — so the sixth file
   * is named and the message is not lost:
   *
   * <ol>
   *   <li><b>the per-message ceiling</b>, by count (paths already on the payload
   *       included): {@code createMessage} throws over the cap rather than
   *       trimming, so the extras are named here instead;
   *   <li><b>the tenant's per-file ceiling</b>, on Resend's claimed size;
   *   <li><b>a source for its id</b>: the URL list is fetched once, here, and a
   *       file with no usable URL or an expiry already past is named without a
   *       call;
   *   <li><b>the ingest itself</b>, {@link #INGEST_CONCURRENCY} at a time — one
   *       refused file is logged and named and never fails the batch or the mail.
   * </ol>
   *
   * A file that passes 1 takes its slot whether or not its ingest then succeeds:
   * with files in flight together, a slot cannot wait on another file's outcome.
   */
  private IngestResult ingestAttachments(
    InboundEmail payload,
    TicketResponse ticket,
    Limits limits,
    RequestContext context,
    AcceptOptions options
  ) {
    List<RemoteAttachment> remote = payload.remoteAttachments();
    List<UploadedAttachment> alreadyStored = payload.attachments();
    if (remote.isEmpty()) {
      return new IngestResult(new ArrayList<>(alreadyStored), List.of());
    }

    Map<String, RemoteAttachmentSource> sources =
      options.fetchAttachmentUrls() != null
        ? options.fetchAttachmentUrls().get()
        : Map.of();

    List<String> dropped = Collections.synchronizedList(new ArrayList<>());
    record Queued(RemoteAttachment file, RemoteAttachmentSource source) {}
    List<Queued> queued = new ArrayList<>();

    for (RemoteAttachment file : remote) {
      if (alreadyStored.size() + queued.size() + 1 > limits.maxPerMessage()) {
        refuse(
          dropped,
          file,
          "only " + limits.maxPerMessage() + " attachments per message"
        );
        continue;
      }
      if (file.sizeBytes() > limits.maxBytes()) {
        refuse(dropped, file, "too large");
        continue;
      }

      RemoteAttachmentSource source = sources.get(file.id());
      if (source == null) {
        refuse(dropped, file, "no usable source URL");
        continue;
      }
      if (
        source.expiresAt() != null && !source.expiresAt().isAfter(Instant.now())
      ) {
        refuse(dropped, file, "source URL expired");
        continue;
      }

      queued.add(new Queued(file, source));
    }

    List<UploadedAttachment> stored = new ArrayList<>(
      Collections.nCopies(queued.size(), (UploadedAttachment) null)
    );
    AtomicInteger next = new AtomicInteger();

    Callable<Void> worker = () -> {
      int index;
      while ((index = next.getAndIncrement()) < queued.size()) {
        Queued job = queued.get(index);
        try {
          var ingested = authorised(
            messages,
            context,
            INGEST_CALL_DEADLINE_MS
          ).ingestAttachment(
            IngestAttachmentRequest.newBuilder()
              .setTicketId(ticket.getId())
              .setFileName(job.file().fileName())
              .setFileSizeBytes(job.file().sizeBytes())
              .setMimeType(job.file().mimeType())
              .setSourceUrl(job.source().sourceUrl())
              .build()
          );
          synchronized (stored) {
            stored.set(
              index,
              new UploadedAttachment(
                ingested.getObjectPath(),
                job.file().fileName()
              )
            );
          }
        } catch (RuntimeException failure) {
          refuse(
            dropped,
            job.file(),
            "refused by storage: " + failure.getMessage()
          );
        }
      }

      return null;
    };

    int workers = Math.min(INGEST_CONCURRENCY, queued.size());
    if (workers > 0) {
      // `close()` waits for the workers: every call has a deadline, and after an
      // interrupt `invokeAll` has cancelled them and gRPC fails the rest at once.
      try (ExecutorService pool = Executors.newFixedThreadPool(workers)) {
        List<Callable<Void>> jobs = new ArrayList<>();
        for (int i = 0; i < workers; i++) jobs.add(worker);
        pool.invokeAll(jobs);
      } catch (InterruptedException interrupted) {
        Thread.currentThread().interrupt();
      }
    }

    List<UploadedAttachment> uploaded = new ArrayList<>(alreadyStored);
    for (UploadedAttachment file : stored) {
      if (file != null) uploaded.add(file);
    }

    return new IngestResult(uploaded, dropped);
  }

  private static void refuse(
    List<String> dropped,
    RemoteAttachment file,
    String reason
  ) {
    LOG.info(
      "Inbound attachment '{}' not stored: {}",
      safe(file.fileName()),
      reason
    );
    dropped.add(file.fileName());
  }

  /**
   * A drop, made visible in all three places: a log line here, a metric from the
   * caller, and ONE auto-reply so the sender is not left with silence — silence is
   * indistinguishable from mail being lost, and the sender is the only person who
   * can act on the difference.
   *
   * <p>The message itself is never logged: it is attacker-controlled text arriving
   * over a channel this system trusts.
   */
  private InboundOutcome drop(
    InboundOutcome outcome,
    InboundEmail payload,
    String organizationId,
    String tenantStatus
  ) {
    // The status is named, because "unroutable" otherwise hides two very different
    // operational states: an address nobody was issued, and a suspended tenant.
    LOG.warn(
      "Inbound email dropped ({}) to={} from={}{}{}",
      outcome.wire(),
      safe(payload.to()),
      safe(payload.from()),
      organizationId == null ? "" : " org=" + organizationId,
      tenantStatus == null ? "" : " status=" + tenantStatus
    );

    // Never reply to an auto-reply. An auto-responder on the other end plus a
    // courtesy reply from us is an unbounded exchange, and these two headers are
    // the standard way a machine says it is one.
    if (LoopGuards.isAutomated(payload.headers())) {
      LOG.info("No auto-reply sent: the message was machine-generated");

      return outcome;
    }

    // No reply when nothing resolved — this system must not be a backscatter
    // source. `from` has been authenticated by nothing at this point: the
    // signature proves Resend sent the delivery, and says nothing about whether the
    // envelope sender is real. Mailing an unroutable address with a forged
    // `From: victim@example.com` would make this domain send unsolicited mail to
    // that victim. SENDER_NOT_PERMITTED still replies: the address resolved to a
    // real tenant, so the sender is far more likely to be a real correspondent
    // using the wrong address than a forged victim.
    if (organizationId == null) {
      LOG.info(
        "No auto-reply sent: the address resolved to no tenant, and replying to an unverified sender would be backscatter"
      );

      return outcome;
    }

    publisher.rejected(
      organizationId,
      payload.from(),
      outcome == InboundOutcome.TENANT_INACTIVE
        ? Reason.UNROUTABLE
        : Reason.SENDER_NOT_PERMITTED
    );

    return outcome;
  }

  /** A stub that carries the caller's context and a deadline on every call it makes. */
  private static <S extends AbstractStub<S>> S authorised(
    S stub,
    RequestOrigin origin,
    long deadlineMs
  ) {
    return stub
      .withDeadlineAfter(deadlineMs, TimeUnit.MILLISECONDS)
      .withInterceptors(
        MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(origin))
      );
  }

  private static <S extends AbstractStub<S>> S authorised(
    S stub,
    RequestContext context,
    long deadlineMs
  ) {
    Metadata metadata = CallerMetadata.of(context);

    return stub
      .withDeadlineAfter(deadlineMs, TimeUnit.MILLISECONDS)
      .withInterceptors(MetadataUtils.newAttachHeadersInterceptor(metadata));
  }

  /** Keeps a sender-controlled value on one log line. */
  private static String safe(String value) {
    return value == null ? "" : value.replaceAll("[\\r\\n\\u2028\\u2029]", "_");
  }

  private static List<String> concat(List<String> first, List<String> second) {
    List<String> all = new ArrayList<>(first);
    all.addAll(second);

    return all;
  }
}
