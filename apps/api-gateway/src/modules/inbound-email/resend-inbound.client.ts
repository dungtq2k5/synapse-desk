import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

/** Injection token for {@link ResendInboundClient}. */
export const RESEND_INBOUND_CLIENT = Symbol('RESEND_INBOUND_CLIENT');

/**
 * The two Resend calls the inbound webhook makes: verify the signature, fetch
 * the mail.
 *
 * Narrowed to those two so a test can replace the fetch while the verifier
 * stays the SDK's own — a faked verifier would let a signing bug pass.
 */
export type ResendInboundClient = {
  webhooks: Pick<Resend['webhooks'], 'verify'>;
  emails: { receiving: Pick<Resend['emails']['receiving'], 'get'> };
};

/**
 * The gateway's Resend client, keyed by `RESEND_GATEWAY_API_KEY`.
 *
 * Built in a factory, after Joi has validated the environment, because
 * `new Resend()` throws on a missing key.
 */
export const resendInboundClientProvider: Provider = {
  provide: RESEND_INBOUND_CLIENT,
  inject: [ConfigService],
  useFactory: (configService: ConfigService): ResendInboundClient =>
    new Resend(configService.getOrThrow<string>('RESEND_GATEWAY_API_KEY')),
};
