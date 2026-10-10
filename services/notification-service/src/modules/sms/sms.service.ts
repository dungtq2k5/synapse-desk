import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import twilio, { type Twilio } from 'twilio';
import { SendSmsCommand, SmsTemplateName } from '@synapsedesk/common';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  /**
   * Null when Twilio is unconfigured. SMS is optional (see env.validation), so
   * the service must still start and serve email — but a send attempt has to
   * fail loudly rather than silently pretend to have delivered a code the user
   * is now waiting for.
   */
  private readonly client: Twilio | null;
  private readonly fromNumber: string;
  private readonly appName: string;

  constructor(private readonly configService: ConfigService) {
    const accountSid = this.configService.get<string>('TWILIO_SID');
    const authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN');
    this.fromNumber = this.configService.get<string>('TWILIO_AUTH_PHONE') ?? '';
    this.appName = this.configService.getOrThrow<string>('APP_NAME');

    this.client =
      accountSid && authToken && this.fromNumber
        ? twilio(accountSid, authToken)
        : null;

    if (!this.client) {
      this.logger.warn(
        'Twilio is not configured — SMS notifications are disabled',
      );
    }
  }

  async send(command: SendSmsCommand): Promise<void> {
    if (!this.client) {
      throw new Error(
        'Twilio is not configured; set TWILIO_SID, TWILIO_AUTH_TOKEN and TWILIO_AUTH_PHONE',
      );
    }

    await this.client.messages.create({
      from: this.fromNumber,
      to: command.to,
      body: this.render(command),
    });

    this.logger.log(`Sent ${command.template} SMS to ${command.to}`);
  }

  private render(command: SendSmsCommand): string {
    switch (command.template) {
      case SmsTemplateName.PHONE_VERIFICATION:
        // Deliberately terse: SMS is billed per 160-character segment, and the
        // code must be the first thing visible in a lock-screen preview.
        return `${command.data.code} is your ${this.appName} verification code. It expires in ${command.data.expiresInMinutes} minutes.`;
    }
  }
}
