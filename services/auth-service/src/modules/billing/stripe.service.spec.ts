import type { ConfigService } from '@nestjs/config';
import { StripeService } from './stripe.service';

/**
 * Where the SDK sends its calls: Stripe's own host, or `STRIPE_API_BASE_URL`
 * (the test stack's fake). The e2e suites stub the SDK, so only this reaches
 * the construction.
 */
function hostOf(env: Record<string, string>) {
  const stripe = new StripeService({
    get: (key: string) => env[key],
  } as unknown as ConfigService);
  stripe.onModuleInit();
  const api = stripe.api;
  return [
    api.getApiField('protocol'),
    api.getApiField('host'),
    api.getApiField('port'),
  ];
}

describe('StripeService host', () => {
  it('unset: Stripe’s own host', () => {
    expect(hostOf({ STRIPE_SECRET_KEY: 'sk_test_x' })).toEqual([
      'https',
      'api.stripe.com',
      '443', // the SDK's own default is a string
    ]);
  });

  it('an http URL with a port: that host and port', () => {
    expect(
      hostOf({
        STRIPE_SECRET_KEY: 'sk_test_x',
        STRIPE_API_BASE_URL: 'http://127.0.0.1:12111',
      }),
    ).toEqual(['http', '127.0.0.1', 12111]);
  });

  it('no port: the protocol’s default', () => {
    expect(
      hostOf({
        STRIPE_SECRET_KEY: 'sk_test_x',
        STRIPE_API_BASE_URL: 'https://stripe.test',
      }),
    ).toEqual(['https', 'stripe.test', 443]);
    expect(
      hostOf({
        STRIPE_SECRET_KEY: 'sk_test_x',
        STRIPE_API_BASE_URL: 'http://stripe.test',
      }),
    ).toEqual(['http', 'stripe.test', 80]);
  });
});
