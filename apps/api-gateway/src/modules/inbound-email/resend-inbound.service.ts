import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { formatErrorMsg, isRetryableResendError } from '@synapsedesk/common';
import { MetricsRegistry } from '../metrics/metrics.registry';
import { VALIDATION_PIPE_OPTIONS } from '../../common/config/validation.config';
import { InboundEmailDto } from './dto/rest/inbound-email.dto';
import { InboundEmailService } from './inbound-email.service';
import {
  RESEND_INBOUND_CLIENT,
  type ResendInboundClient,
} from './resend-inbound.client';
import { toMappedInboundEmail } from './resend-inbound.mapper';

/** The Standard Webhooks headers Resend signs a delivery with. */
export const RESEND_SIGNATURE_HEADERS = {
  id: 'svix-id',
  timestamp: 'svix-timestamp',
  signature: 'svix-signature',
} as const;

/**
 * Webhook exits that happen before, or instead of, `accept()`. Every other
 * `outcome` label is an `InboundOutcome`.
 */
export enum ResendWebhookOutcome {
  NO_RAW_BODY = 'no_raw_body',
  REJECTED_SIGNATURE = 'rejected_signature',
  IGNORED_EVENT = 'ignored_event',
  FETCH_FAILED = 'fetch_failed',
  INVALID_PAYLOAD = 'invalid_payload',
}

/** What one webhook delivery carries into the handler. */
export type ResendWebhookDelivery = {
  /** The exact bytes received — the signature is over these, never a re-serialisation. */
  rawBody: Buffer | undefined;
  /** Reads one request header. */
  header: (name: string) => string | undefined;
};

/** The response body of every 200. */
export type ResendWebhookAck = { received: true; outcome: string };

/**
 * Turns one Resend `email.received` delivery into an `accept()` call.
 *
 * Every exit increments `inbound_email_webhook_total{outcome}` exactly once:
 *
 * | Exit | HTTP | `outcome` |
 * | :--- | :--- | :--- |
 * | no raw body (a bootstrap without `rawBody: true`) | 401 | `no_raw_body` |
 * | a missing `svix-*` header, or `verify()` throws | 401 | `rejected_signature` |
 * | a verified event that is not `email.received` | 200 | `ignored_event` |
 * | a retryable fetch error (429, 5xx, network) | 503 | — (Resend redelivers; counted as `fetch_failed`) |
 * | a fetch error a retry will not change (404, 401) | 200 | `fetch_failed` |
 * | the mapped mail fails the DTO's constraints | 200 | `invalid_payload` |
 * | `accept()` ran | 200 | its `InboundOutcome` |
 *
 * **Nothing unauthenticated causes work.** The signature is checked before any
 * call to Resend or any gRPC peer, and nothing from a rejected body is logged.
 *
 * **200 after verification unless a retry can help.** Resend redelivers any
 * non-2xx for about 17.6 hours, so a mail this system decided to drop, a mail
 * that cannot pass validation, and a fetch that will fail identically all answer
 * 200 and are visible in the counter instead.
 */
@Injectable()
export class ResendInboundService {
  private readonly logger = new Logger(ResendInboundService.name);

  private readonly webhookSecret: string;
  private readonly inboundDomain: string;

  constructor(
    @Inject(RESEND_INBOUND_CLIENT)
    private readonly resend: ResendInboundClient,
    private readonly inbound: InboundEmailService,
    private readonly metrics: MetricsRegistry,
    configService: ConfigService,
  ) {
    this.webhookSecret = configService.getOrThrow<string>(
      'RESEND_WEBHOOK_SECRET',
    );
    this.inboundDomain = configService.getOrThrow<string>(
      'INBOUND_EMAIL_DOMAIN',
    );
  }

  /**
   * Handles one delivery; see the class docblock for every exit.
   *
   * @throws UnauthorizedException when the body is missing or the signature
   * does not verify.
   * @throws ServiceUnavailableException when fetching the mail failed in a way
   * a later retry can fix.
   */
  async handle(delivery: ResendWebhookDelivery): Promise<ResendWebhookAck> {
    if (!delivery.rawBody) {
      // A CONFIGURATION failure, not a caller one — `rawBody: true` missing from
      // `NestFactory.create`. Saying so is what stops somebody regenerating a
      // secret that was never the problem.
      this.logger.error(
        'Resend webhook received no raw body — NestFactory must be created with `rawBody: true`',
      );
      return this.reject(ResendWebhookOutcome.NO_RAW_BODY);
    }

    const event = this.verify(delivery.rawBody, delivery.header);
    if (!event) return this.reject(ResendWebhookOutcome.REJECTED_SIGNATURE);

    if (event.type !== 'email.received') {
      return this.ok(ResendWebhookOutcome.IGNORED_EVENT);
    }

    const { email_id: emailId } = event.data;
    const { data: email, error } =
      await this.resend.emails.receiving.get(emailId);

    if (error || !email) {
      const detail = error
        ? `${error.name} (${error.statusCode ?? 'no status'})`
        : 'an empty response';

      if (error && isRetryableResendError(error)) {
        this.logger.warn(
          `Could not fetch inbound mail ${emailId}, asking Resend to retry: ${detail}`,
        );
        this.count(ResendWebhookOutcome.FETCH_FAILED);

        throw new ServiceUnavailableException('Inbound mail fetch failed');
      }

      // A 404 or a wrongly scoped key fails identically on every retry, so it is
      // answered 200 and left to the counter; the log line names the cause.
      this.logger.error(
        `Could not fetch inbound mail ${emailId}, dropping it: ${detail}`,
      );
      return this.ok(ResendWebhookOutcome.FETCH_FAILED);
    }

    const mapped = toMappedInboundEmail(event, email, this.inboundDomain);

    if (mapped.tenantRecipientCount > 1) {
      this.logger.warn(
        `Inbound mail ${emailId} reached ${mapped.tenantRecipientCount} tenant addresses; routing by the first`,
      );
    }

    // **Validated by hand, because nothing else will.** This object is built
    // here, not received as a `@Body()`, so the global pipe never sees it.
    const dto = plainToInstance(InboundEmailDto, mapped.fields);
    const errors = await validate(dto, VALIDATION_PIPE_OPTIONS);

    if (errors.length > 0) {
      // The constraint names, never the values — the body is sender-controlled.
      this.logger.warn(
        `Inbound mail ${emailId} failed validation on: ${errors
          .map((failure) => failure.property)
          .join(', ')}`,
      );
      return this.ok(ResendWebhookOutcome.INVALID_PAYLOAD);
    }

    return this.ok(await this.inbound.accept(dto));
  }

  /** The verified event, or `null` for a missing header or a bad signature. */
  private verify(
    rawBody: Buffer,
    header: (name: string) => string | undefined,
  ): ReturnType<ResendInboundClient['webhooks']['verify']> | null {
    const id = header(RESEND_SIGNATURE_HEADERS.id);
    const timestamp = header(RESEND_SIGNATURE_HEADERS.timestamp);
    const signature = header(RESEND_SIGNATURE_HEADERS.signature);

    if (!id || !timestamp || !signature) return null;

    try {
      return this.resend.webhooks.verify({
        payload: rawBody.toString('utf8'),
        headers: { id, timestamp, signature },
        webhookSecret: this.webhookSecret,
      });
    } catch (error) {
      // `verify()` THROWS on a bad signature or a stale timestamp. Nothing about
      // the body is logged: an unauthenticated caller wrote every byte of it.
      this.logger.warn(`Resend webhook rejected: ${formatErrorMsg(error)}`);
      return null;
    }
  }

  private count(outcome: string): void {
    this.metrics.inboundEmailWebhook.inc({ outcome });
  }

  private ok(outcome: string): ResendWebhookAck {
    this.count(outcome);

    return { received: true, outcome };
  }

  private reject(outcome: ResendWebhookOutcome): never {
    this.count(outcome);

    throw new UnauthorizedException('Signature could not be verified');
  }
}
