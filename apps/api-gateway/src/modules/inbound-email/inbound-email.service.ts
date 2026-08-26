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
  formatErrorMsg,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
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
import type { InboundUploadedAttachmentDto } from './dto/rest/inbound-email.dto';
import {
  InboundAttachmentDeclinedDto,
  InboundAttachmentUploadDto,
  InboundAttachmentUploadRequestDto,
  InboundAttachmentUploadResponseDto,
} from './dto/rest/inbound-attachment.dto';
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
  ): Promise<T> {
    return this.call(invoke, origin);
  }
}

/**
 * The only fields routing reads.
 *
 * **Narrow on purpose.** `InboundEmailDto` satisfies it and so does the
 * Worker's presign request, which is what lets one resolver serve both — and
 * the narrowness is the documentation: nothing about the SUBJECT or the BODY
 * decides which ticket a mail threads onto, and a resolver typed to the whole
 * payload invites somebody to start reading them.
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
 * event, and the Worker's presign route treats all three as "no".
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

  async accept(payload: InboundEmailDto): Promise<InboundOutcome> {
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
    // **One resolver, shared with the Worker's presign route**'s
    // reply half. The Worker presigns against a ticket BEFORE this webhook
    // runs; if the two resolutions could disagree, a customer's screenshot
    // would be uploaded under one ticket's prefix and attached to another's
    // message.
    const routing = await this.resolveRouting(payload);

    if (!routing.ok) {
      return this.drop(
        routing.outcome,
        payload,
        routing.organizationId ?? null,
        routing.status ?? undefined,
      );
    }

    const { context, ticket, addressedToTicket } = routing;

    // **The note is applied ONCE, for both paths** — and until now it was not.
    //
    // `withAttachmentNote` was only ever reached on ticket creation, so an
    // emailed REPLY carrying attachments dropped them in silence: no file, no
    // note, nothing in the thread saying anything had been left out. That was
    // survivable while mail dropped every attachment, because the customer at
    // least got the note on their first mail. It stops being survivable now
    // that some attachments land and some do not — a partial delivery with no
    // record of the missing half is worse than a total one.
    const body = this.withAttachmentNote(
      toStoredBody(payload.text, payload.html),
      payload,
    );
    const inboundMessageId = this.idempotencyKeyFor(payload);

    try {
      if (ticket) {
        // The thread this mail belongs to, already resolved above.
        const appended = await this.append(
          ticket,
          body,
          inboundMessageId,
          context,
          payload.attachments,
        );
        if (appended) return InboundOutcome.APPENDED;
      } else if (addressedToTicket) {
        // The token verified but the ticket is gone. A new ticket is the safe
        // direction — because the alternative is discarding a
        // customer's message.
      }

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
   * Presigns uploads for a mail's attachments, the reply half.
   *
   * **Called BEFORE the webhook, by the Worker, over the same signed channel.**
   * The bytes go from the Worker straight to storage and never touch this
   * server, which is the property the presign flow exists to hold and the
   * one an inbound mail most threatens: the Worker has the bytes whether anyone
   * wanted them or not, and uploading them through the webhook would make
   * `/webhooks/email/inbound` the only route in the system that accepts
   * arbitrary file bytes from an unauthenticated sender.
   *
   * **Eligibility is decided here, not in the Worker.** The allowlist, the size
   * cap and the per-message ceiling are policy, and a second copy of policy in a
   * Cloudflare Worker is a copy that drifts. The Worker presents what it parsed
   * and is told which files it may upload; the rest come back NAMED so the
   * ticket can still say what was left out.
   *
   * **A mail that would CREATE a ticket declines everything**, because there is
   * no ticket for the object path to hang under — the new-ticket half,
   * which is blocked on a separate decision.
   */
  async presignAttachments(
    request: InboundAttachmentUploadRequestDto,
  ): Promise<InboundAttachmentUploadResponseDto> {
    const uploads: InboundAttachmentUploadDto[] = [];
    const declined: InboundAttachmentDeclinedDto[] = [];

    const routing = await this.resolveRouting({
      to: request.to,
      from: request.from,
      fromName: request.fromName,
      inReplyTo: request.inReplyTo,
      references: request.references,
    });

    if (!routing.ok || !routing.ticket) {
      // One reason for every file, and it is the same reason: either the mail
      // does not route, or it opens a new ticket. Neither has somewhere to put
      // a file.
      return {
        uploads: [],
        declined: request.files.map((file) => ({
          fileName: file.fileName,
          reason: routing.ok ? 'no ticket to attach to' : 'unroutable',
        })),
      };
    }

    // `min(platform, tenant)`, resolved when the tenant was — this path is
    // reachable by anyone who can email the address, so a workspace that
    // narrowed its attachment limit has not got the control it asked for if
    // these two numbers stay constants.
    const { context, ticket, limits } = routing;

    for (const file of request.files) {
      // **The per-message ceiling, applied HERE.** `createMessage` throws when
      // the list is over the cap rather than trimming it — so a mail with eight
      // attachments would lose the MESSAGE, not the extra files. Declining the
      // sixth here keeps that a partial loss with a name on it.
      if (uploads.length >= limits.maxPerMessage) {
        declined.push({
          fileName: file.fileName,
          reason: `only ${limits.maxPerMessage} attachments per message`,
        });
        continue;
      }

      if (file.sizeBytes > limits.maxBytes) {
        declined.push({ fileName: file.fileName, reason: 'too large' });
        continue;
      }

      try {
        const presigned = await this.ticketPeer.run(
          (metadata) =>
            this.messages.uploadAttachment(
              {
                ticketId: ticket.id,
                // No message yet — it is created by the webhook that follows,
                // and the message-first upload flow made presigning without one possible.
                messageId: undefined,
                fileName: file.fileName,
                fileSizeBytes: file.sizeBytes,
                mimeType: file.mimeType,
              },
              metadata,
            ),
          context,
        );

        uploads.push({
          fileName: file.fileName,
          uploadUrl: presigned.uploadUrl,
          objectPath: presigned.objectPath,
        });
      } catch (error) {
        // One refused file must not fail the batch, and must not fail the mail
        // either — the message still lands, minus this attachment.
        this.logger.warn(
          `Could not presign an inbound attachment: ${formatErrorMsg(error)}`,
        );
        declined.push({
          fileName: file.fileName,
          reason: 'refused by storage',
        });
      }
    }

    return { uploads, declined };
  }

  /**
   * The tenant, the sender and the ticket a message threads onto — what both
   * `accept` and the Worker's presign route need.
   *
   * **Extracted rather than duplicated**, because the two must not be able to
   * disagree. The Worker presigns against a ticket BEFORE the webhook runs, and
   * the webhook binds the objects to whatever ticket it resolves — so a
   * divergence would upload a customer's screenshot under one ticket's prefix
   * and attach it to another's message.
   *
   * **Failures come back as an OUTCOME rather than `null`**: unroutable,
   * suspended tenant and refused sender are three drop events with three
   * telemetry meanings, and collapsing them would force `accept` to keep its own
   * copy of this sequence to tell them apart.
   *
   * A `ticket` of `null` on success means the mail would CREATE a ticket — the
   * case the Worker cannot presign for, because no ticket owns the path.
   *
   * **Read-only.** It may PROVISION a sender, but writes no ticket and no
   * message, so the presign route does not half-process an unaccepted mail.
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

    // `min(platform, tenant)`, composed once for this mail. Absent means the
    // tenant configured nothing, which is the normal state and today's
    // behaviour.
    const limits = {
      maxBytes: Math.min(
        MAX_ATTACHMENT_BYTES,
        maxAttachmentBytesOverride ?? MAX_ATTACHMENT_BYTES,
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
            // **Uploaded by the Worker before this webhook ran**.
            //
            // This list is for a client that uploaded BEFORE the message
            // existed, and inbound mail is now exactly that client: the Worker
            // presigns against the resolved ticket, PUTs the bytes straight to
            // storage, and sends only object paths. ticket-service confirms
            // each one as it writes the message.
            //
            // Empty for a mail that opens a NEW ticket — there is no message to
            // attach to, so the presign route declined everything and those
            // names travel in `droppedAttachments` instead.
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
    // The first version hashed `receivedAt`, which the Worker stamps fresh on
    // each attempt — so a redelivery produced a new key, a new ticket, and
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
  private withAttachmentNote(body: string, payload: InboundEmailDto): string {
    if (!payload.droppedAttachments?.length) return body;

    return `${body}\n\n---\nAttachments were not accepted by email: ${payload.droppedAttachments.join(', ')}`;
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
    // invisible once the body is parsed, which is why the Worker forwards
    // exactly them.
    if (this.isAutomated(payload)) {
      this.logger.log('No auto-reply sent: the message was machine-generated');

      return outcome;
    }

    // **No reply when nothing resolved — this system must not be a backscatter
    // source.**
    //
    // `from` has been authenticated by nothing at this point: the signature
    // proves the Worker sent the request, and says nothing about whether the
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
