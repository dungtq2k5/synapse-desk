import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import { SendEmailCommand } from '@synapsedesk/common';
import { renderEmail, type TemplateBranding } from './email.templates';

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

  async send(command: SendEmailCommand): Promise<void> {
    const { subject, html, text } = renderEmail(command, this.branding);

    await this.transporter.sendMail({
      from: this.sender,
      to: command.to,
      subject,
      html,
      text,
    });

    // The recipient is logged, the contents are not: verification codes and
    // reset links must never reach application logs.
    this.logger.log(`Sent ${command.template} email to ${command.to}`);
  }
}
