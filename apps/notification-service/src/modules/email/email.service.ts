import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import { SendEmailCommand } from '@synapsedesk/common';
import { renderEmail, type TemplateBranding } from './email.templates';

/** What the caller needs back — see `send()`. */
export type SendEmailResult = {
  /** The SMTP `Message-ID`, or null if the transport did not report one. */
  messageId: string | null;
};

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);

  private readonly transporter: Transporter;
  private readonly sender: string;
  private readonly branding: TemplateBranding;

  constructor(private readonly configService: ConfigService) {
    this.sender = this.configService.getOrThrow<string>('EMAIL_SENDER');
    this.branding = {
      appName: this.configService.getOrThrow<string>('APP_NAME'),
      appWebUrl: this.configService.getOrThrow<string>('APP_WEB_URL'),
      supportEmail: this.configService.getOrThrow<string>('SUPPORT_EMAIL'),
    };

    this.transporter = createTransport({
      host: this.configService.getOrThrow<string>('EMAIL_HOST'),
      port: this.configService.getOrThrow<number>('EMAIL_PORT'),
      // true only for 465 (implicit TLS). On 587 this must be false, and
      // nodemailer upgrades via STARTTLS — setting it true there hangs.
      secure: this.configService.get<string>('EMAIL_SECURE') === 'true',
      auth: {
        user: this.configService.getOrThrow<string>('EMAIL_USER'),
        pass: this.configService.getOrThrow<string>('EMAIL_PASS'),
      },
    });
  }

  /**
   * Verifies SMTP credentials once at boot rather than on the first send.
   *
   * Deliberately does NOT throw: a mail outage must not stop the service from
   * consuming its queue, or every queued notification would be lost instead of
   * failing individually and retryably.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.transporter.verify();
      this.logger.log('SMTP transport verified');
    } catch (error) {
      this.logger.warn(
        `SMTP transport is not usable — emails will fail until this is fixed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Sends, and returns the provider's own message id.
   *
   * Returned rather than discarded because `notification_deliveries` stores it
   * (RDM Table 24): an SMTP `Message-ID` is what correlates a provider bounce
   * webhook back to the row that sent it. Nothing consumes those webhooks yet
   * (18-doc §8), which is exactly why the id has to be captured now — it cannot
   * be recovered later for mail that has already gone out.
   */
  async send(command: SendEmailCommand): Promise<SendEmailResult> {
    const { subject, html, text } = renderEmail(command, this.branding);

    // nodemailer types `sendMail`'s result loosely, and only `messageId` is
    // read. Narrowed at the boundary so the `any` cannot leak into a delivery
    // row that claims to hold a provider id.
    const info = (await this.transporter.sendMail({
      from: this.sender,
      to: command.to,
      subject,
      html,
      text,
    })) as { messageId?: string } | undefined;

    // The recipient is logged, the contents are not: verification codes and
    // reset links must never reach application logs.
    this.logger.log(`Sent ${command.template} email to ${command.to}`);

    return { messageId: info?.messageId ?? null };
  }
}
