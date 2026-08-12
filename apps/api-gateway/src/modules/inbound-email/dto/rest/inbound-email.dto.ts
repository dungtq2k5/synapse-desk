import {
  IsArray,
  IsEmail,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  MAX_EMAIL_ADDRESS_LENGTH,
  MAX_FULL_NAME_LENGTH,
  MAX_HEADER_LINE_LENGTH,
  MAX_MESSAGE_ID_LENGTH,
  PRINTABLE_ASCII,
} from '../../../../common/config/dto.config';
import { IsPresentButNullable } from '../../../../common/decorators/is-nullable.decorator';

/**
 * What the mail Worker POSTs — 32-doc §2, §3.1.
 *
 * **This is a CONTRACT, not a description.** Stripe's DTO documents somebody
 * else's payload; here both halves are ours — the Worker in `workers/email-inbound/`
 * is the only caller and it lives in this repo. So this class is the agreement
 * between the two, and OpenAPI is where they can be checked against each other
 * rather than kept in step by hand.
 *
 * **Every field is bounded.** The caller is authenticated by signature, which
 * proves the Worker sent it and nothing about what a stranger put in the mail —
 * the subject, the body and the sender name are all attacker-controlled text
 * that happens to arrive over a trusted channel.
 */
export class InboundEmailDto {
  /**
   * The message's own `Message-ID` header — the idempotency key (31-doc §7).
   *
   * Optional because it is a header a sender can omit. When absent, the
   * receiving side synthesizes one from `from + subject + date`: weaker, and
   * better than a retry storm creating one ticket per attempt.
   */
  @IsOptional()
  @IsString()
  @Matches(PRINTABLE_ASCII, {
    message: 'messageId must be printable ASCII (RFC 5322 msg-id)',
  })
  @MaxLength(MAX_MESSAGE_ID_LENGTH)
  readonly messageId?: string;

  /** The address the mail was delivered to — `support+{token}@…`. */
  @IsString()
  @MaxLength(MAX_EMAIL_ADDRESS_LENGTH)
  readonly to!: string;

  /**
   * The sender's address.
   *
   * Validated as an email because everything downstream treats it as one: the
   * domain decides whether an account may be provisioned (31-doc §3), and a
   * malformed value would make that check meaningless rather than merely ugly.
   */
  @IsEmail()
  @MaxLength(MAX_EMAIL_ADDRESS_LENGTH)
  readonly from!: string;

  /** The `From` display name, when the client sent one. */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_FULL_NAME_LENGTH)
  readonly fromName?: string;

  @IsString()
  @MaxLength(MAX_HEADER_LINE_LENGTH)
  readonly subject!: string;

  /** The `text/plain` part. Null when the sender wrote HTML only. */
  @IsPresentButNullable()
  @IsString()
  readonly text!: string | null;

  /** The `text/html` part, used only when `text` is absent. */
  @IsPresentButNullable()
  @IsString()
  readonly html!: string | null;

  /** `In-Reply-To`, for the threading fallback (31-doc §4). */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_MESSAGE_ID_LENGTH)
  readonly inReplyTo?: string;

  /** `References`, oldest first — the same fallback, one hop wider. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(MAX_MESSAGE_ID_LENGTH, { each: true })
  readonly references?: string[];

  /**
   * The loop-guard headers, and only those — 32-doc §2.
   *
   * `Auto-Submitted` and `Precedence` are invisible once the body is parsed,
   * and they are what stop an auto-responder and this system replying to each
   * other forever. The Worker forwards exactly these two rather than the whole
   * header block: a full copy is unbounded attacker-controlled data with one
   * use.
   */
  @IsOptional()
  @IsObject()
  readonly headers?: Record<string, string>;

  /**
   * Filenames of attachments the Worker DROPPED — 31-doc §5.
   *
   * Carried so the ticket can say what was omitted. *"Attachments silently
   * vanish"* is something a customer discovers before you do.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  readonly droppedAttachments?: string[];

  /**
   * The message's own `Date` header, verbatim.
   *
   * **A property of the MESSAGE, which is what makes it usable as an
   * idempotency key** — 31-doc §7. `receivedAt` below is generated fresh on
   * every delivery attempt, so a key built from it changes on each retry and
   * dedups nothing.
   *
   * Not parsed or normalised: it is hashed, and two deliveries of one message
   * carry byte-identical headers. Optional because a sender can omit it.
   */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  readonly date?: string;

  /**
   * When the WORKER received it, ISO 8601.
   *
   * **Never part of the idempotency key.** Cloudflare re-runs a Worker that
   * threw, and each run stamps a new value — which is precisely the retry the
   * key exists to collapse.
   */
  @IsISO8601({ strict: true })
  readonly receivedAt!: string;
}
