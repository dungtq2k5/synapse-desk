/**
 * What a Resend webhook delivery is answered with: an acknowledgement and the
 * outcome, never the message.
 */
export class ResendWebhookAcknowledgementResponseDto {
  readonly received!: boolean;
  /** What became of the mail, for Resend's delivery log. */
  readonly outcome!: string;
}
