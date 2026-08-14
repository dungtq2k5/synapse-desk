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
  type MessageServiceClient,
  type NotificationServiceClient,
  type TicketResponse,
  type OrganizationServiceClient,
  type TicketServiceClient,
  type UserServiceClient,
  fromProtoOrgStatus,
} from '@synapsedesk/grpc-proto';
import {
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
import { InboundEmailPublisher } from './inbound-email.publisher';
import { toStoredBody } from './quoted-reply';

/**
 * Why a message did not become a ticket, or what it became.
 *
 * **Every one of these is answered with a 200** — 32-doc §3.1. A 4xx tells the
 * provider the request was malformed and worth retrying, so one misconfigured
 * mail rule would become a retry loop against this endpoint. The outcome
 * travels in the body instead, where an operator can see it and a provider
 * cannot act on it.
 */
export enum InboundOutcome {
  CREATED = 'ticket_created',
  APPENDED = 'message_appended',
  DUPLICATE = 'duplicate',
  UNROUTABLE = 'unroutable_address',
  /** A real tenant, but not one currently accepting anything — 31-doc §2. */
  TENANT_INACTIVE = 'tenant_inactive',
  SENDER_REFUSED = 'sender_not_permitted',
  /** Our own notification came back to us — 31-doc §7. */
  SELF_LOOP = 'self_addressed',
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
  constructor(protected readonly serviceName: string) {
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
 * The email adapter — 31-doc §6, 32-doc §4.
 *
 * **The gateway is the only component that knows what an email is.** Address
 * parsing, the reply-token HMAC, quoted history and the loop headers are all
 * transport; the tenant, the sender and the ticket are RPCs to the services
 * that own them. ticket-service never learns that mail exists — it receives a
 * ticket with `source = EMAIL` and an idempotency key.
 *
 * Order is fixed and each step gates the next (32-doc §4.2): **tenant, then
 * sender, then thread.** Resolving the tenant later would mean running the
 * sender query unscoped, which is the cross-tenant misroute 31-doc §3 exists
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
    // **Before anything else, and unconditionally** — 31-doc §7. A mail loop is
    // the classic way an email integration takes out a mailbox, and its blast
    // radius is somebody else's.
    if (this.isSelfAddressed(payload.from)) {
      // Not even a rejection event: replying to ourselves is the loop.
      this.logger.warn('Inbound email ignored: it came from our own address');

      return InboundOutcome.SELF_LOOP;
    }

    // ---------------------------------------------------------- 1. tenant
    const address = parseInboundAddress(payload.to);

    if (!address) {
      return this.drop(InboundOutcome.UNROUTABLE, payload, null);
    }

    const { organizationId, status: tenantStatus } = await this.authPeer.run(
      (metadata) =>
        this.organizations.resolveOrgByInboundToken(
          { inboundToken: address.tenantToken },
          metadata,
        ),
      // No caller identity exists yet — the tenant is what this call resolves.
      UNKNOWN_ORIGIN,
    );

    if (!organizationId) {
      return this.drop(InboundOutcome.UNROUTABLE, payload, null);
    }

    // **The lifecycle gate, applied HERE because it cannot apply where it
    // normally does.** The global interceptor reads `organizations.status` off
    // the caller's identity, and this route has none — the tenant comes from
    // the payload. 32-doc §3 records that the route "bypasses the tenant
    // lifecycle gate", and that means bypassing WHERE the check happens, not
    // whether it happens: a suspended tenant taking mail would grow a queue
    // nobody may read, and provision End Users into a workspace that is closed
    // to its own members.
    //
    // Only ACTIVE accepts. `PENDING_ONBOARDING` is deliberately included in the
    // refusal: a tenant that has not finished setup has no departments, no
    // agents and no one to route to, so mail would land in a queue with no
    // reader — and the sender gets told, which is better than silence.
    if (fromProtoOrgStatus(tenantStatus) !== OrgStatus.ACTIVE) {
      return this.drop(
        InboundOutcome.TENANT_INACTIVE,
        payload,
        organizationId,
        fromProtoOrgStatus(tenantStatus),
      );
    }

    // ---------------------------------------------------------- 2. sender
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

    // Not a member, and their domain is not permitted here. The auto-reply that
    // tells them so is step 6 — the drop itself is visible now.
    if (!sender.userId) {
      return this.drop(InboundOutcome.SENDER_REFUSED, payload, organizationId);
    }

    if (sender.created) {
      this.logger.log(
        `Provisioned an End User for ${payload.from} in ${organizationId}`,
      );
    }

    // ---------------------------------------------------------- 3. thread
    //
    // The caller context every RPC below is scoped by. Assembled from the
    // RESOLVED tenant and sender rather than from anything the message claimed
    // — the only facts here that survived verification.
    const context: RequestContext = {
      ...UNKNOWN_ORIGIN,
      sub: sender.userId,
      organizationId,
      isSuperAdmin: false,
      departmentIds: [],
      permissionCodes: [],
      isEmailVerified: false,
    };

    const body = toStoredBody(payload.text, payload.html);
    const inboundMessageId = this.idempotencyKeyFor(payload);
    const ticketNumber = this.ticketFromReplyToken(address, organizationId);

    try {
      if (ticketNumber !== null) {
        const appended = await this.appendByNumber(
          ticketNumber,
          body,
          inboundMessageId,
          context,
        );

        if (appended) return InboundOutcome.APPENDED;
        // The token verified but the ticket is gone. A new ticket is the safe
        // direction — 31-doc §4 — because the alternative is discarding a
        // customer's message.
      } else if (!address.ticketToken) {
        // **The `In-Reply-To` fallback** — 31-doc §4. Someone replying to a
        // forwarded copy, or writing to the bare support address about an
        // existing issue, carries no ticket token but does echo back the
        // `Message-ID` of the mail they are answering.
        //
        // **Guarded on the ABSENCE of a token, not on a null ticket number** —
        // and the difference is the security property. Both cases produce a
        // null number: an address with no token at all, and one whose token
        // failed its MAC. Falling through on the second would hand back exactly
        // the threading the MAC just refused, using a header the same sender
        // also controls.
        const ticketId = await this.ticketFromHeaders(payload, organizationId);

        if (
          ticketId &&
          (await this.appendToTicket(ticketId, body, inboundMessageId, context))
        ) {
          return InboundOutcome.APPENDED;
        }
      }

      await this.ticketPeer.run(
        (metadata) =>
          this.tickets.createTicket(
            {
              title: payload.subject.trim() || '(no subject)',
              description: this.withAttachmentNote(body, payload),
              source: ProtoTicketSource.TICKET_SOURCE_EMAIL,
              // **UNSPECIFIED, not a guess.** No mail header states a priority,
              // and inferring one from "URGENT!!" in the subject would let the
              // sender set their own. Unspecified means ticket-service applies
              // its own default (MEDIUM), so the rule lives in one place and an
              // emailed ticket is triaged like any other.
              priority: ProtoTicketPriority.TICKET_PRIORITY_UNSPECIFIED,
              authorId: sender.userId,
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

  private async appendByNumber(
    ticketNumber: number,
    body: string,
    inboundMessageId: string,
    context: RequestContext,
  ): Promise<boolean> {
    // Typed rather than inferred: `firstValueFrom` in a `try` widens to `any`
    // when the binding has no annotation, and every read below then silently
    // stops being checked — including `status`, which is a proto enum this
    // path has already been caught comparing against the wrong type once.
    let ticket: TicketResponse;
    try {
      ticket = await this.ticketPeer.run(
        (metadata) =>
          this.tickets.getTicketByNumber({ ticketNumber }, metadata),
        context,
      );
    } catch {
      return false;
    }

    return this.append(ticket, body, inboundMessageId, context);
  }

  /**
   * Appends to a ticket named by ID — the `In-Reply-To` path.
   *
   * **The ticket is re-fetched under the CALLER's context rather than trusted.**
   * The id came from notification-service's join, which is already scoped to
   * this tenant; fetching it through ticket-service means the answer is scoped
   * twice, by two services, from two directions. That is the difference between
   * an isolation guarantee and an isolation convention.
   */
  private async appendToTicket(
    ticketId: string,
    body: string,
    inboundMessageId: string,
    context: RequestContext,
  ): Promise<boolean> {
    let ticket: TicketResponse;
    try {
      ticket = await this.ticketPeer.run(
        (metadata) => this.tickets.getTicket({ id: ticketId }, metadata),
        context,
      );
    } catch {
      return false;
    }

    return this.append(ticket, body, inboundMessageId, context);
  }

  /**
   * The write both threading paths share.
   *
   * **A CLOSED ticket is reopened through the transition, never a status
   * write** — 32-doc §4.2, the same rule `message:send` follows. Reopened
   * first, so the reply never lands on a ticket the state machine still
   * considers finished.
   */
  private async append(
    ticket: TicketResponse,
    body: string,
    inboundMessageId: string,
    context: RequestContext,
  ): Promise<boolean> {
    if (ticket.status === ProtoTicketStatus.TICKET_STATUS_CLOSED) {
      await this.ticketPeer.run(
        (md) => this.tickets.reopenTicket({ id: ticket.id }, md),
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
            // by definition, and the one thing 22-doc §1 found leaking was an
            // internal note reaching one.
            isInternalNote: false,
            invokeAi: false,
            inboundMessageId,
            // Mail carries its own attachments through a different path — the
            // worker uploads and confirms them against the message it just
            // created (31-doc §5). This list is for a client that uploaded
            // BEFORE the message existed, which no inbound email does.
            attachments: [],
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
    payload: InboundEmailDto,
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
   * 31-doc §7: a missing header is not a reason to skip the check. Without a
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
   * Notes what was dropped, in the body — 31-doc §5.
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
   * A drop, made visible in the three places 31-doc §3 requires.
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

    // **Never reply to an auto-reply** — 31-doc §7. An auto-responder on the
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

    return extractAddress(from) === extractAddress(sender);
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

/**
 * The bare address out of a `From` header.
 *
 * `"Support" <support@app.test>` and `support@app.test` are the same sender, and
 * the self-loop guard comparing the whole header would miss the first form —
 * failing OPEN into the loop it exists to stop.
 *
 * Unanchored deliberately: a `From` may carry a comment or an encoded word
 * before the angle brackets, and the first bracketed run is the address in
 * every form of the header that reaches us.
 *
 * **Exported for the env cross-check** in `env.validation.spec.ts`, which
 * asserts that this gateway and notification-service name the same sending
 * address. That test has to compare them the way the GUARD does — the two
 * `.env` files carry different display names around one address, which is
 * decoration rather than disagreement — and a second spelling of this in the
 * test would be a test that agrees with itself.
 */
export function extractAddress(value: string): string {
  const angled = /<([^>]+)>/.exec(value); // NOSONAR

  return (angled?.[1] ?? value).trim().toLowerCase();
}
