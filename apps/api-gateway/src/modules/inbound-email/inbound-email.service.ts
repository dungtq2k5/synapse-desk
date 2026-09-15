import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientGrpc } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import type { Observable } from 'rxjs';
import type { Metadata } from '@grpc/grpc-js';
import {
  AUTH_GRPC_CLIENT,
  MESSAGE_SERVICE_NAME,
  NOTIFICATION_GRPC_CLIENT,
  NOTIFICATION_SERVICE_NAME,
  ORGANIZATION_SERVICE_NAME,
  TICKET_GRPC_CLIENT,
  TICKET_SERVICE_NAME,
  TicketPriority as ProtoTicketPriority,
  TicketSource as ProtoTicketSource,
  TicketStatus as ProtoTicketStatus,
  USER_SERVICE_NAME,
  fromProtoOrgStatus,
  type GrpcPeer,
  type MessageServiceClient,
  type NotificationServiceClient,
  type OrganizationServiceClient,
  type TicketResponse,
  type TicketServiceClient,
  type UserServiceClient,
} from '@synapsedesk/grpc-proto';
import {
  extractEmailAddress,
  INGEST_DEADLINE_MS,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  exceedsLimit,
  formatErrorMsg,
  OrgStatus,
  parseInboundAddress,
  parseTicketReplyToken,
  UNKNOWN_ORIGIN,
  type RequestContext,
  type RequestOrigin,
  InboundRejectionReason,
} from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';
import { InboundEmailDto } from './dto/rest/inbound-email.dto';
import type {
  InboundRemoteAttachmentDto,
  InboundUploadedAttachmentDto,
  RemoteAttachmentSource,
} from './dto/rest/inbound-email.dto';
import { InboundEmailPublisher } from './inbound-email.publisher';
import { toStoredBody } from './quoted-reply';

/**
 * Why a message did not become a ticket, or what it became.
 *
 * **Every one of these is answered with a 200**. A 4xx tells the
 * provider the request was malformed and worth retrying, so one misconfigured
 * mail rule would become a retry loop against this endpoint. The outcome
 * travels in the body instead, where an operator can see it and a provider
 * cannot act on it.
 */
export enum InboundOutcome {
  CREATED = 'TICKET_CREATED',
  APPENDED = 'MESSAGE_APPENDED',
  DUPLICATE = 'DUPLICATE',
  UNROUTABLE = 'UNROUTABLE_ADDRESS',
  /** A real tenant, but not one currently accepting anything. */
  TENANT_INACTIVE = 'TENANT_INACTIVE',
  /**
   * Deliberately the same spelling as
   * {@link InboundRejectionReason.SENDER_NOT_PERMITTED}, which `drop` maps this
   * to: two enums describing one refusal, and lower-case here was the reason
   * they did not look like it.
   */
  SENDER_REFUSED = 'SENDER_NOT_PERMITTED',
  /** Our own notification came back to us. */
  SELF_LOOP = 'SELF_ADDRESSED',
}

/**
 * One peer, so `BaseGrpcClient` can be used by a class that talks to several.
 *
 * `BaseGrpcClient` names its peer in a `protected abstract readonly` field —
 * one instance, one peer, because that field is also the `peer` label on the
 * latency metric and the name a 504 reports. This adapter calls three services
 * across five stubs, so it composes three of these rather than extending the
 * base class once and mislabelling every measurement it takes.
 *
 * What it buys is the reason not to hand-roll the calls: the shared deadline
 * (an unbounded call from a webhook is a hung request holding a socket the
 * sender will retry behind), the timeout-to-504 translation, and the outbound
 * latency metric that every other gateway client reports.
 */
class InboundPeer extends BaseGrpcClient {
  constructor(protected readonly serviceName: GrpcPeer) {
    super();
  }

  run<T>(
    invoke: (metadata: Metadata) => Observable<T>,
    origin: RequestOrigin | RequestContext,
    deadlineMs?: number,
  ): Promise<T> {
    return this.call(invoke, origin, deadlineMs);
  }
}

/**
 * The only fields routing reads.
 *
 * **Narrow on purpose.** `InboundEmailDto` satisfies it, and the narrowness is
 * the documentation: nothing about the SUBJECT or the BODY decides which ticket
 * a mail threads onto, and a resolver typed to the whole payload invites
 * somebody to start reading them.
 */
type RoutingFacts = {
  to: string;
  from: string;
  fromName?: string;
  inReplyTo?: string;
  references?: string[];
};

/**
 * What `resolveRouting` found's reply half.
 *
 * A discriminated result rather than a nullable one, so the three ways a mail
 * can be unroutable stay distinguishable: `accept` turns each into its own drop
 * event.
 */
type RoutingResolution =
  | {
      ok: false;
      outcome: InboundOutcome;
      organizationId?: string;
      /** `null` when the peer reported a status this gateway does not know. */
      status?: OrgStatus | null;
    }
  | {
      ok: true;
      organizationId: string;
      context: RequestContext;
      /**
       * The tenant's attachment ceilings, platform ceilings already applied.
       *
       * Carried on the routing result because the lookup that resolves the
       * tenant returns them — inbound mail is the one attachment surface
       * reachable by anyone who can email the address, and a tenant that
       * narrowed its limit for safety reasons has not got the control it asked
       * for if the limit applies only to authenticated uploads.
       */
      limits: { maxBytes: number; maxPerMessage: number };
      /**
       * Whether the address itself named a ticket.
       *
       * Distinguishes "a reply whose ticket vanished" from "a fresh mail" — the
       * first is a drop, the second creates a ticket, and they arrive here
       * looking identical once `ticket` is null.
       */
      addressedToTicket: boolean;
      /** `null` when this mail would CREATE a ticket rather than thread onto one. */
      ticket: TicketResponse | null;
    };

/**
 * Attachments ingested at once for one mail.
 *
 * **Two, not one after another and not all at once.** Every file is a fetch of
 * up to `MAX_ATTACHMENT_BYTES` inside ONE webhook request, and a request that
 * outlasts Resend's response timeout is redelivered — re-ingesting every file.
 * Sequential fetches stack the time; unbounded ones would put a mail's whole
 * attachment list on storage-service at once. The per-mail worst case is
 * `ceil(n / INGEST_CONCURRENCY) × (INGEST_DEADLINE_MS + 5_000)`.
 */
export const INGEST_CONCURRENCY = 2;

/** What `accept` needs from the transport beyond the mail itself. */
export type AcceptOptions = {
  /**
   * The signed sources of the mail's remote attachments, by Resend id. Called
   * at most once, and only when routing has produced a ticket.
   */
  fetchAttachmentUrls?: () => Promise<Map<string, RemoteAttachmentSource>>;
};

/** What ingest produced: paths for `createMessage`, and the names it refused. */
type IngestResult = {
  uploaded: InboundUploadedAttachmentDto[];
  dropped: string[];
};

/**
 * The email adapter
 *
 * **The gateway is the only component that knows what an email is.** Address
 * parsing, the reply-token HMAC, quoted history and the loop headers are all
 * transport; the tenant, the sender and the ticket are RPCs to the services
 * that own them. ticket-service never learns that mail exists — it receives a
 * ticket with `source = EMAIL` and an idempotency key.
 *
 * Order is fixed and each step gates the next: **tenant, then
 * sender, then thread.** Resolving the tenant later would mean running the
 * sender query unscoped, which is the cross-tenant misroute the tenant token exists
 * to prevent.
 */
@Injectable()
export class InboundEmailService implements OnModuleInit {
  private readonly logger = new Logger(InboundEmailService.name);

  private organizations!: OrganizationServiceClient;
  private users!: UserServiceClient;
  private tickets!: TicketServiceClient;
  private messages!: MessageServiceClient;
  private notifications!: NotificationServiceClient;

  private readonly authPeer = new InboundPeer('auth-service');
  private readonly ticketPeer = new InboundPeer('ticket-service');
  private readonly notificationPeer = new InboundPeer('notification-service');

  constructor(
    @Inject(AUTH_GRPC_CLIENT) private readonly authClient: ClientGrpc,
    @Inject(TICKET_GRPC_CLIENT) private readonly ticketClient: ClientGrpc,
    @Inject(NOTIFICATION_GRPC_CLIENT)
    private readonly notificationClient: ClientGrpc,
    private readonly configService: ConfigService,
    private readonly publisher: InboundEmailPublisher,
  ) {}

  onModuleInit(): void {
    this.organizations = this.authClient.getService<OrganizationServiceClient>(
      ORGANIZATION_SERVICE_NAME,
    );
    this.users =
      this.authClient.getService<UserServiceClient>(USER_SERVICE_NAME);
    this.tickets =
      this.ticketClient.getService<TicketServiceClient>(TICKET_SERVICE_NAME);
    this.messages =
      this.ticketClient.getService<MessageServiceClient>(MESSAGE_SERVICE_NAME);
    this.notifications =
      this.notificationClient.getService<NotificationServiceClient>(
        NOTIFICATION_SERVICE_NAME,
      );
  }

  async accept(
    payload: InboundEmailDto,
    options: AcceptOptions = {},
  ): Promise<InboundOutcome> {
    // ------------------------------------------------------- 0. loop guards
    //
    // **Before anything else, and unconditionally**. A mail loop is
    // the classic way an email integration takes out a mailbox, and its blast
    // radius is somebody else's.
    if (this.isSelfAddressed(payload.from)) {
      // Not even a rejection event: replying to ourselves is the loop.
      this.logger.warn('Inbound email ignored: it came from our own address');

      return InboundOutcome.SELF_LOOP;
    }

    // ------------------------------------------- 1-3. tenant, sender, thread
    //
    // **One resolver, and the only place routing is decided.** Anything that
    // later stores an attachment for this mail must resolve the ticket through
    // it too; two resolutions that could disagree would put a customer's
    // screenshot under one ticket's prefix and attach it to another's message.
    const routing = await this.resolveRouting(payload);

    if (!routing.ok) {
      return this.drop(
        routing.outcome,
        payload,
        routing.organizationId ?? null,
        routing.status ?? undefined,
      );
    }

    const { context, ticket, addressedToTicket, limits } = routing;

    // **Ingest BEFORE the note is written**, because the note names what ingest
    // refuses. On a mail that opens a ticket there is no message to attach to
    // — `createTicket` writes a ticket row and no message — so every eligible
    // attachment is named as dropped, alongside the ones the mapper refused.
    const ingested: IngestResult = ticket
      ? await this.ingestAttachments(payload, ticket, limits, context, options)
      : {
          uploaded: [],
          dropped: payload.remoteAttachments.map((file) => file.fileName),
        };
    const storedBody = toStoredBody(payload.text, payload.html);
    // **The note is applied on both paths**: a partial delivery with no record
    // of the missing half is worse than a total one.
    const dropped = [...payload.droppedAttachments, ...ingested.dropped];
    const inboundMessageId = this.idempotencyKeyFor(payload);
    let createNote = dropped;

    try {
      if (ticket) {
        // The thread this mail belongs to, already resolved above.
        const appended = await this.append(
          ticket,
          this.withAttachmentNote(storedBody, dropped),
          inboundMessageId,
          context,
          ingested.uploaded,
        );
        if (appended) return InboundOutcome.APPENDED;

        // The ticket is gone after all, and a new one is created below. The
        // files were ingested under the OLD ticket's prefix and are never
        // attached to another ticket, so the new ticket's note names them too;
        // their objects stay unconfirmed under `pending/`.
        createNote = [
          ...dropped,
          ...ingested.uploaded.map((file) => file.fileName),
        ];
      } else if (addressedToTicket) {
        // The token verified but the ticket is gone. A new ticket is the safe
        // direction — because the alternative is discarding a
        // customer's message.
      }

      const body = this.withAttachmentNote(storedBody, createNote);

      await this.ticketPeer.run(
        (metadata) =>
          this.tickets.createTicket(
            {
              title: payload.subject.trim() || '(no subject)',
              description: body,
              source: ProtoTicketSource.TICKET_SOURCE_EMAIL,
              // **UNSPECIFIED, not a guess.** No mail header states a priority,
              // and inferring one from "URGENT!!" in the subject would let the
              // sender set their own. Unspecified means ticket-service applies
              // its own default (MEDIUM), so the rule lives in one place and an
              // emailed ticket is triaged like any other.
              priority: ProtoTicketPriority.TICKET_PRIORITY_UNSPECIFIED,
              // The resolved sender, which is what `context.sub` already is —
              // the only identity here that survived verification.
              authorId: context.sub,
              inboundMessageId,
            },
            metadata,
          ),
        context,
      );

      return InboundOutcome.CREATED;
    } catch (error) {
      // A redelivery. The provider retries by design, so this is the NORMAL
      // path rather than a fault: the first attempt already produced the
      // ticket, and the correct answer is 200 and a stop.
      if (isAlreadyExists(error)) return InboundOutcome.DUPLICATE;

      // Anything else propagates. An infrastructure failure must NOT be a 200:
      // that would tell the provider the mail was accepted and lose it, where a
      // 5xx makes it retry and the dedup row makes that retry safe.
      throw error;
    }
  }

  /**
   * The tenant, the sender and the ticket a message threads onto.
   *
   * **One method, so attachment storage can share it.** An attachment stored
   * against a ticket and a message bound to whatever ticket `accept` resolves
   * must never disagree, or a customer's screenshot lands under one ticket's
   * prefix and attached to another's message. `limits` is resolved here for the
   * same reason: the tenant's attachment caps belong to the same lookup.
   *
   * **Failures come back as an OUTCOME rather than `null`**: unroutable,
   * suspended tenant and refused sender are three drop events with three
   * telemetry meanings, and collapsing them would force `accept` to keep its own
   * copy of this sequence to tell them apart.
   *
   * A `ticket` of `null` on success means the mail would CREATE a ticket — the
   * case with no ticket to own an attachment path.
   *
   * **Read-only.** It may PROVISION a sender, but writes no ticket and no
   * message, so a caller that only needs the routing does not half-process an
   * unaccepted mail.
   */
  private async resolveRouting(
    payload: RoutingFacts,
  ): Promise<RoutingResolution> {
    const address = parseInboundAddress(payload.to);
    if (!address) {
      return { ok: false, outcome: InboundOutcome.UNROUTABLE };
    }

    const {
      organizationId,
      status: tenantStatus,
      maxAttachmentBytesOverride,
      maxAttachmentsPerMessageOverride,
      maxAttachmentBytes,
    } = await this.authPeer.run(
      (metadata) =>
        this.organizations.resolveOrgByInboundToken(
          { inboundToken: address.tenantToken },
          metadata,
        ),
      UNKNOWN_ORIGIN,
    );

    if (!organizationId) {
      return { ok: false, outcome: InboundOutcome.UNROUTABLE };
    }

    // `min(platform, plan, tenant)`, composed once for this mail. An absent
    // OVERRIDE means the tenant configured nothing, which is the normal state
    // and falls through to the layer above; an absent PLAN GRANT is a wire that
    // lost a non-optional field, and refuses rather than widens. See
    // `loader-defaults.spec.ts` for why the two differ.
    //
    // This runs only after the `organizationId` check above, so the zero the
    // unresolved-tenant branches report never reaches here.
    const limits = {
      maxBytes: Math.min(
        MAX_ATTACHMENT_BYTES,
        maxAttachmentBytesOverride ?? MAX_ATTACHMENT_BYTES,
        maxAttachmentBytes ?? 0,
      ),
      maxPerMessage: Math.min(
        MAX_ATTACHMENTS_PER_MESSAGE,
        maxAttachmentsPerMessageOverride ?? MAX_ATTACHMENTS_PER_MESSAGE,
      ),
    };

    const status = fromProtoOrgStatus(tenantStatus);
    if (status !== OrgStatus.ACTIVE) {
      return {
        ok: false,
        outcome: InboundOutcome.TENANT_INACTIVE,
        organizationId,
        status,
      };
    }

    const sender = await this.authPeer.run(
      (metadata) =>
        this.users.resolveInboundSender(
          {
            organizationId,
            email: payload.from,
            displayName: payload.fromName,
          },
          metadata,
        ),
      UNKNOWN_ORIGIN,
    );
    if (!sender.userId) {
      return {
        ok: false,
        outcome: InboundOutcome.SENDER_REFUSED,
        organizationId,
      };
    }

    if (sender.created) {
      this.logger.log(
        `Provisioned an End User for ${payload.from} in ${organizationId}`,
      );
    }

    const context: RequestContext = {
      ...UNKNOWN_ORIGIN,
      sub: sender.userId,
      organizationId,
      isSuperAdmin: false,
      departmentIds: [],
      permissionCodes: [],
      isEmailVerified: false,
    };

    const ticketNumber = this.ticketFromReplyToken(address, organizationId);
    if (ticketNumber !== null) {
      return {
        ok: true,
        limits,
        organizationId,
        context,
        // **A reply token naming a ticket that does not resolve stays a
        // reply.** `accept` drops it as unroutable rather than creating a
        // second ticket from a reply — the token said which thread this
        // belongs to, and inventing a new one would split the conversation.
        addressedToTicket: true,
        ticket: await this.loadTicket(
          (metadata) =>
            this.tickets.getTicketByNumber({ ticketNumber }, metadata),
          context,
        ),
      };
    }

    if (!address.ticketToken) {
      const ticketId = await this.ticketFromHeaders(payload, organizationId);
      if (ticketId) {
        const ticket = await this.loadTicket(
          (metadata) => this.tickets.getTicket({ id: ticketId }, metadata),
          context,
        );
        if (ticket) {
          return {
            ok: true,
            limits,
            organizationId,
            context,
            addressedToTicket: false,
            ticket,
          };
        }
      }
    }

    // Routable, and it would CREATE a ticket rather than thread onto one.
    return {
      ok: true,
      limits,
      organizationId,
      context,
      addressedToTicket: false,
      ticket: null,
    };
  }

  /** A ticket fetch whose failure is "no such ticket", not an error. */
  private async loadTicket(
    fetch: (metadata: Metadata) => Observable<TicketResponse>,
    context: RequestContext,
  ): Promise<TicketResponse | null> {
    try {
      return await this.ticketPeer.run(fetch, context);
    } catch {
      return null;
    }
  }

  /**
   * The write every threading path shares.
   *
   * **The two `appendBy…` wrappers that used to sit here are gone.** They each
   * fetched a ticket and called this; `resolveRouting` now does the fetching
   * for both callers, so keeping them would have left two ways to reach this
   * write and only one of them reachable.
   *
   * **A CLOSED ticket is reopened through the transition, never a status
   * write**, the same rule `message:send` follows. Reopened
   * first, so the reply never lands on a ticket the state machine still
   * considers finished.
   */
  private async append(
    ticket: TicketResponse,
    body: string,
    inboundMessageId: string,
    context: RequestContext,
    attachments?: InboundUploadedAttachmentDto[],
  ): Promise<boolean> {
    if (ticket.status === ProtoTicketStatus.TICKET_STATUS_CLOSED) {
      await this.ticketPeer.run(
        (md) =>
          this.tickets.reopenTicket(
            {
              ticketId: ticket.id,
              // The first system-supplied reason in the tree, and the case the
              // field is most needed for: this transition has no actor, so
              // without it the history shows a closed ticket reopening itself.
              reason: 'Reopened by an inbound email reply',
            },
            md,
          ),
        context,
      );
    }

    await this.ticketPeer.run(
      (metadata) =>
        this.messages.createMessage(
          {
            ticketId: ticket.id,
            content: body,
            // **Never an internal note.** A customer's reply is customer-visible
            // by definition, and the one thing found leaking was an
            // internal note reaching one.
            isInternalNote: false,
            invokeAi: false,
            inboundMessageId,
            // **Objects already in storage before the message exists.**
            //
            // This list is for a client that uploaded BEFORE the message
            // existed; ticket-service confirms each path as it writes the
            // message. Empty from the Resend webhook, which names every
            // attachment in `droppedAttachments` instead, and always empty for
            // a mail that opens a NEW ticket — there is no message to attach to.
            attachments: attachments ?? [],
          },
          metadata,
        ),
      context,
    );

    return true;
  }

  /**
   * The ticket an `In-Reply-To` or `References` header points at.
   *
   * **`References` is tried after `In-Reply-To`, newest first.** Clients drop
   * and rewrite these more than the RFC suggests, and `References` is the
   * ordered thread history — its LAST entry is the message being answered,
   * which is the one most likely to be ours.
   *
   * Bounded, because `References` grows by one entry per hop: an unbounded loop
   * would let one long thread cost dozens of RPCs.
   */
  private async ticketFromHeaders(
    payload: RoutingFacts,
    organizationId: string,
  ): Promise<string | null> {
    const candidates = [
      payload.inReplyTo,
      ...[...(payload.references ?? [])].reverse(),
    ]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value))
      .slice(0, MAX_THREAD_LOOKUPS);

    for (const providerMessageId of candidates) {
      const { ticketId } = await this.notificationPeer.run(
        (metadata) =>
          this.notifications.resolveTicketByMessageId(
            { providerMessageId, organizationId },
            metadata,
          ),
        UNKNOWN_ORIGIN,
      );

      if (ticketId) return ticketId;
    }

    return null;
  }

  /** The verified ticket number in the address, or `null`. */
  private ticketFromReplyToken(
    address: { ticketToken: string | null },
    organizationId: string,
  ): number | null {
    if (!address.ticketToken) return null;

    const secret = this.configService.getOrThrow<string>(
      'INBOUND_EMAIL_SECRET',
    );

    const ticketNumber = parseTicketReplyToken(
      address.ticketToken,
      organizationId,
      secret,
    );

    if (ticketNumber === null) {
      // A forged or stale token. Logged, then treated as no token at all — the
      // message opens a NEW ticket rather than being refused, because the
      // sender is legitimate and only the address was wrong.
      this.logger.warn(
        `Inbound reply token failed verification for ${organizationId}`,
      );
    }

    return ticketNumber;
  }

  /**
   * The idempotency key — the `Message-ID`, or a digest when it had none.
   *
   * A missing header is not a reason to skip the check. Without a
   * key, a retry storm creates one ticket per attempt.
   */
  private idempotencyKeyFor(payload: InboundEmailDto): string {
    const messageId = payload.messageId?.trim();
    if (messageId) return messageId;

    // **Every input is a property of the MESSAGE, and that is the whole point.**
    // `receivedAt` describes the delivery, not the message, so a key built from
    // it could change between redeliveries — a new key, a new ticket, and
    // exactly the retry storm the fallback exists to prevent.
    //
    // The BODY is in the digest because sender, subject and second are not
    // enough to tell two genuinely different messages apart: somebody firing
    // off two replies in the same second with the same subject is ordinary, and
    // merging them would lose one. `date` is the sender's own header, absent
    // for some clients, which the empty string covers without changing shape.
    const digest = createHash('sha256')
      .update(
        [
          payload.from,
          payload.subject,
          payload.date ?? '',
          payload.text ?? payload.html ?? '',
        ].join('\u0000'),
      )
      .digest('hex');

    return `synthesized:${digest}`;
  }

  /**
   * Notes what was dropped, in the body.
   *
   * *"Attachments silently vanish"* is something a customer finds before you
   * do, so the omission is visible to everyone on the thread rather than only
   * in a log nobody reads.
   */
  private withAttachmentNote(body: string, names: string[]): string {
    if (names.length === 0) return body;

    return `${body}\n\n---\nAttachments were not accepted by email: ${names.join(', ')}`;
  }

  /**
   * Stores a reply's remote attachments through ticket-service and returns the
   * object paths for `createMessage`, plus the names of every file refused.
   *
   * The rules, in order, with a name for everything refused — so the sixth file
   * is named and the message is not lost:
   *
   * 1. **the per-message ceiling**, by count (paths already on the payload
   *    included): `createMessage` throws over the cap rather than trimming, so
   *    the extras are named here instead;
   * 2. **the tenant's per-file ceiling**, on Resend's claimed size — the stream
   *    is cut at the same number by storage-service;
   * 3. **a source for its id**: the URL list is fetched once, here, and a file
   *    with no usable URL (a short list, `has_more`, a URL storage could not
   *    take) or an expiry already past is named without a call;
   * 4. **the ingest itself**, {@link INGEST_CONCURRENCY} at a time, under a
   *    deadline five seconds wider than ticket-service's own on storage — one
   *    refused file is logged and named and never fails the batch or the mail.
   *
   * A file that passes 1 takes its slot whether or not its ingest then
   * succeeds: with files in flight together, a slot cannot wait on another
   * file's outcome.
   *
   * @throws ServiceUnavailableException when the URL list failed in a way a
   * retry can fix — before anything was stored.
   */
  private async ingestAttachments(
    payload: InboundEmailDto,
    ticket: TicketResponse,
    limits: { maxBytes: number; maxPerMessage: number },
    context: RequestContext,
    options: AcceptOptions,
  ): Promise<IngestResult> {
    const remote = payload.remoteAttachments;
    const alreadyStored = payload.attachments ?? [];
    if (remote.length === 0)
      return { uploaded: [...alreadyStored], dropped: [] };

    const sources = options.fetchAttachmentUrls
      ? await options.fetchAttachmentUrls()
      : new Map<string, RemoteAttachmentSource>();

    const dropped: string[] = [];
    const queued: {
      file: InboundRemoteAttachmentDto;
      source: RemoteAttachmentSource;
    }[] = [];
    const refuse = (file: InboundRemoteAttachmentDto, reason: string) => {
      this.logger.log(
        `Inbound attachment '${file.fileName}' not stored: ${reason}`,
      );
      dropped.push(file.fileName);
    };

    for (const file of remote) {
      if (
        exceedsLimit(
          alreadyStored.length + queued.length + 1,
          limits.maxPerMessage,
        )
      ) {
        refuse(file, `only ${limits.maxPerMessage} attachments per message`);
        continue;
      }
      if (exceedsLimit(file.sizeBytes, limits.maxBytes)) {
        refuse(file, 'too large');
        continue;
      }

      const source = sources.get(file.id);
      if (!source) {
        refuse(file, 'no usable source URL');
        continue;
      }
      if (source.expiresAt.getTime() <= Date.now()) {
        refuse(file, 'source URL expired');
        continue;
      }

      queued.push({ file, source });
    }

    const stored: (InboundUploadedAttachmentDto | null)[] =
      new Array<InboundUploadedAttachmentDto | null>(queued.length).fill(null);
    let next = 0;

    const worker = async (): Promise<void> => {
      while (next < queued.length) {
        const index = next++;
        const { file, source } = queued[index];

        try {
          const { objectPath } = await this.ticketPeer.run(
            (metadata) =>
              this.messages.ingestAttachment(
                {
                  ticketId: ticket.id,
                  fileName: file.fileName,
                  fileSizeBytes: file.sizeBytes,
                  mimeType: file.mimeType,
                  sourceUrl: source.sourceUrl,
                },
                metadata,
              ),
            context,
            INGEST_DEADLINE_MS + 5_000,
          );
          stored[index] = { objectPath, fileName: file.fileName };
        } catch (error) {
          refuse(file, `refused by storage: ${formatErrorMsg(error)}`);
        }
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(INGEST_CONCURRENCY, queued.length) },
        worker,
      ),
    );

    return {
      uploaded: [
        ...alreadyStored,
        ...stored.filter(
          (file): file is InboundUploadedAttachmentDto => file !== null,
        ),
      ],
      dropped,
    };
  }

  /**
   * A drop, made visible in all three places.
   *
   * A log line here, a metric from it, and ONE auto-reply so the sender is not
   * left with silence — silence is indistinguishable from mail being lost, and
   * the sender is the only person who can act on the difference.
   *
   * The message itself is never logged: it is attacker-controlled text arriving
   * over a channel this system trusts.
   */
  private drop(
    outcome: InboundOutcome,
    payload: InboundEmailDto,
    organizationId: string | null,
    tenantStatus?: OrgStatus | null,
  ): InboundOutcome {
    // The status is named, because "unroutable" otherwise hides two very
    // different operational states: an address nobody was issued, and a real
    // tenant that has been suspended.
    this.logger.warn(
      `Inbound email dropped (${outcome}) to=${payload.to} from=${payload.from}` +
        (organizationId ? ` org=${organizationId}` : '') +
        (tenantStatus ? ` status=${tenantStatus}` : ''),
    );

    // **Never reply to an auto-reply**. An auto-responder on the
    // other end plus a courtesy reply from us is an unbounded exchange, and
    // these two headers are the standard way a machine says it is one. They are
    // invisible once the body is parsed, which is why the webhook mapper copies
    // exactly them.
    if (this.isAutomated(payload)) {
      this.logger.log('No auto-reply sent: the message was machine-generated');

      return outcome;
    }

    // **No reply when nothing resolved — this system must not be a backscatter
    // source.**
    //
    // `from` has been authenticated by nothing at this point: the signature
    // proves Resend sent the delivery, and says nothing about whether the
    // envelope sender is real. SMTP `From` is trivially forged, so mailing an
    // unroutable address with `From: victim@example.com` would make this domain
    // send unsolicited mail to that victim — which is what puts a sending
    // domain on blocklists. The per-address daily cap bounds the volume per
    // victim and does nothing about the NUMBER of victims.
    //
    // Refusing an unknown recipient belongs at the MTA, during the SMTP
    // transaction, where the sending server is told directly and no new mail is
    // generated.
    //
    // `SENDER_NOT_PERMITTED` still replies: the address resolved to a real
    // tenant, so the message reached a destination somebody configured, and the
    // sender is far more likely to be a real correspondent using the wrong
    // address than a forged victim.
    if (!organizationId) {
      this.logger.log(
        'No auto-reply sent: the address resolved to no tenant, and replying ' +
          'to an unverified sender would be backscatter',
      );

      return outcome;
    }

    this.publisher.rejected({
      organizationId,
      sender: payload.from,
      reason:
        outcome === InboundOutcome.TENANT_INACTIVE
          ? InboundRejectionReason.UNROUTABLE
          : InboundRejectionReason.SENDER_NOT_PERMITTED,
    });

    return outcome;
  }

  /**
   * Whether this message came from our own sending address.
   *
   * Compared case-insensitively on the address alone, because `From` may be
   * `"SynapseDesk Support" <support@…>` and the display name is decoration a
   * sender controls.
   */
  private isSelfAddressed(from: string): boolean {
    const sender = this.configService
      .getOrThrow<string>('EMAIL_SENDER')
      .toLowerCase();

    return extractEmailAddress(from) === extractEmailAddress(sender);
  }

  /** `Auto-Submitted` / `Precedence` — the headers a machine sets. */
  private isAutomated(payload: InboundEmailDto): boolean {
    const headers = Object.fromEntries(
      Object.entries(payload.headers ?? {}).map(([key, value]) => [
        key.toLowerCase(),
        String(value).toLowerCase(),
      ]),
    );

    const autoSubmitted = headers['auto-submitted'] ?? '';
    const precedence = headers['precedence'] ?? '';

    // `auto-generated`, `auto-replied`, `auto-notified` — anything but `no`.
    return (
      (autoSubmitted !== '' && autoSubmitted !== 'no') ||
      ['bulk', 'list', 'junk'].includes(precedence)
    );
  }
}

/**
 * How many thread headers are worth a lookup.
 *
 * `References` grows by one entry per hop, so a long thread would otherwise
 * make one email cost dozens of RPCs — and the entry that matches is
 * overwhelmingly the newest.
 */
const MAX_THREAD_LOOKUPS = 5;

/** A redelivery, as ticket-service reports it. */
function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: number }).code === GrpcStatus.ALREADY_EXISTS
  );
}
