import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { Resend } from 'resend';
import {
  isRetryableResendError,
  SendEmailCommand,
  UnprocessableMessage,
  extractEmailAddress,
  extractEmailDomain,
} from '@synapsedesk/common';
import { renderEmail, type TemplateBranding } from './email.templates';

/** What the caller needs back — see `send()`. */
export type SendEmailResult = {
  /** The RFC `Message-ID` this send carried — ours, never the provider's id. */
  messageId: string;
};

export type SendEmailOptions = {
  /** The `Reply-To` address; omitted when there is nothing to reply to. */
  replyTo?: string;
  /**
   * The recipient's user id, when ONE command fans out to several people.
   *
   * Part of the send's identity: the in-app path emails every recipient of one
   * event under that event's `sendId`, and without this the second recipient's
   * send would reuse the first one's idempotency key with a different `to` —
   * which the provider refuses.
   */
  recipientUserId?: string;
};

/**
 * The provider idempotency key for one send.
 *
 * `template/sendId`, plus `/recipientUserId` on a fan-out. Deterministic from
 * the command, so a JetStream redelivery reproduces it exactly.
 *
 * @example idempotencyKeyFor({ template: 'PAYMENT_FAILED', sendId: 'dunning:evt_1' }, 'u-1') // 'PAYMENT_FAILED/dunning:evt_1/u-1'
 */
export function idempotencyKeyFor(
  command: Pick<SendEmailCommand, 'template' | 'sendId'>,
  recipientUserId?: string,
): string {
  const key = `${command.template}/${command.sendId}`;

  return recipientUserId ? `${key}/${recipientUserId}` : key;
}

/**
 * The RFC 5322 `Message-ID` for one send, derived from its idempotency key.
 *
 * **Derived, never random.** The header is part of the request body, and the
 * provider compares bodies under a key: a random id would make a redelivery the
 * same key with a different payload, answered `409` on exactly the retry the key
 * exists for.
 *
 * **Hashed, not spelled out.** A `sendId` can be an event id such as
 * `dunning:evt_1` or `ticket.escalated:…:2026-09-15T10:00:00.000Z`, and `:` is
 * not allowed in a `Message-ID`'s left-hand side. The SHA-256 hex digest is
 * always valid there and still reproducible from the command.
 *
 * @example messageIdFor('WELCOME/1f53…', 'synapsedesk.com') // '<9c1e…64 hex…@synapsedesk.com>'
 */
export function messageIdFor(idempotencyKey: string, domain: string): string {
  const digest = createHash('sha256').update(idempotencyKey).digest('hex');

  return `<${digest}@${domain}>`;
}

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);

  private readonly sender: string;
  private readonly senderDomain: string;
  private readonly branding: TemplateBranding;
  private resend!: Resend;

  constructor(private readonly configService: ConfigService) {
    this.sender = this.configService.getOrThrow<string>('EMAIL_SENDER');
    this.branding = {
      appName: this.configService.getOrThrow<string>('APP_NAME'),
      appWebUrl: this.configService.getOrThrow<string>('APP_WEB_URL'),
      supportEmail: this.configService.getOrThrow<string>('SUPPORT_EMAIL'),
    };

    const domain = extractEmailDomain(extractEmailAddress(this.sender));
    if (!domain) {
      throw new Error(
        `EMAIL_SENDER has no domain to build a Message-ID from: ${this.sender}`,
      );
    }
    this.senderDomain = domain;
  }

  /**
   * Builds the Resend client once the environment has been validated.
   *
   * In `onModuleInit` rather than the constructor's field list because
   * `new Resend()` THROWS on a missing key, and a throw there reads as a DI
   * failure rather than as the configuration error it is.
   *
   * **No boot-time probe.** Resend has no free credential check: `domains.list()`
   * needs a full-access key and answers a sending-only key with
   * `401 restricted_api_key`. Joi has already checked the `re_` shape; the first
   * send is what surfaces a revoked key, as a classified error like any other.
   */
  onModuleInit(): void {
    this.resend = new Resend(
      this.configService.getOrThrow<string>('RESEND_API_KEY'),
    );
  }

  /**
   * Sends one email through the Resend API and returns its `Message-ID`.
   *
   * **The id returned is OURS** — the header this call set, not Resend's
   * `data.id`. `notification_deliveries.provider_message_id` stores it, and the
   * inbound `In-Reply-To` fallback matches it against what a customer's client
   * echoes back; only the RFC header is ever echoed. Resend's id is logged beside
   * it so a dashboard search still finds the mail.
   *
   * **Idempotent per send.** The idempotency key and the `Message-ID` both come
   * from `command.sendId` (and the recipient on a fan-out), so a redelivery sends
   * a byte-identical request under the same key and Resend returns the first
   * result instead of a second mail.
   *
   * @throws UnprocessableMessage for an error a retry cannot change (a bad
   * address, a restricted key, a quota) — the JetStream consumer parks it on the
   * dead-letter subject without spending retries.
   * @throws Error for a retryable one (429, 5xx, the network, a concurrent use of
   * the same key) — the consumer redelivers, and the key collapses the duplicate.
   */
  async send(
    command: SendEmailCommand,
    options: SendEmailOptions = {},
  ): Promise<SendEmailResult> {
    const { subject, html, text } = renderEmail(command, this.branding);
    const idempotencyKey = idempotencyKeyFor(command, options.recipientUserId);
    const messageId = messageIdFor(idempotencyKey, this.senderDomain);

    // The SDK returns `{ data, error }` and does not throw for an API error, so
    // the branch below is the whole error path — a try/catch would see nothing.
    const { data, error } = await this.resend.emails.send(
      {
        from: this.sender,
        to: command.to,
        // **Without this the whole reply-token design is dead**.
        // The reply-to address is only authoritative because the client
        // replies to the one it was GIVEN; offering none means every reply goes
        // to the bare sender address, carries no ticket token, and opens a
        // duplicate ticket.
        //
        // Optional, because most mail here is transactional and has nothing to
        // reply to — a password reset with a support Reply-To invites a
        // conversation nobody is listening for.
        ...(options.replyTo ? { replyTo: options.replyTo } : {}),
        subject,
        html,
        text,
        headers: { 'Message-ID': messageId },
      },
      { idempotencyKey },
    );

    if (error) {
      // The recipient and the provider's words are logged; the contents are
      // not — verification codes and reset links must never reach logs.
      const detail = `${command.template} email to ${command.to}: ${error.name} (${error.statusCode ?? 'no status'}) ${error.message}`;

      if (isRetryableResendError(error)) {
        throw new Error(`Retryable failure sending ${detail}`);
      }

      throw new UnprocessableMessage(`Permanent failure sending ${detail}`);
    }

    this.logger.log(
      `Sent ${command.template} email to ${command.to} (${messageId}, resend ${data?.id ?? 'no id'})`,
    );

    return { messageId };
  }
}
