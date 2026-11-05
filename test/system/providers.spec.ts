import { realProviders } from './providers';

/** What `useTestProviders` writes: nothing in it reaches a real provider. */
const SAFE = {
  RESEND_BASE_URL: 'http://localhost:12112',
  RESEND_API_KEY: 're_fake_resend_for_the_stack',
  RESEND_GATEWAY_API_KEY: 're_fake_resend_for_the_stack',
  STRIPE_API_BASE_URL: 'http://localhost:12111',
  STRIPE_SECRET_KEY: 'sk_test_fake_stripe',
  FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9099',
  FIREBASE_STORAGE_EMULATOR_HOST: 'localhost:9199',
};

/** `SAFE` without the named variables. */
const without = (...names: (keyof typeof SAFE)[]) =>
  Object.fromEntries(
    Object.entries(SAFE).filter(
      ([name]) => !names.includes(name as keyof typeof SAFE),
    ),
  );

describe('realProviders', () => {
  it('finds nothing in the test values', () => {
    expect(realProviders(SAFE)).toEqual([]);
  });

  it("names Resend when a key would go to Resend's real API", () => {
    expect(realProviders(without('RESEND_BASE_URL'))).toEqual([
      expect.stringMatching(
        /^Resend: RESEND_API_KEY and RESEND_GATEWAY_API_KEY set/,
      ),
    ]);
    expect(
      realProviders({ ...SAFE, RESEND_BASE_URL: 'https://api.resend.com' }),
    ).toEqual([expect.stringContaining('not local (https://api.resend.com)')]);
  });

  it("names Stripe when its key would go to Stripe's real API", () => {
    expect(realProviders(without('STRIPE_API_BASE_URL'))).toEqual([
      expect.stringMatching(/^Stripe: /),
    ]);
  });

  it('names Firebase Auth and Storage without their emulators', () => {
    expect(
      realProviders(
        without(
          'FIREBASE_AUTH_EMULATOR_HOST',
          'FIREBASE_STORAGE_EMULATOR_HOST',
        ),
      ),
    ).toEqual([
      expect.stringMatching(/^Firebase Auth: /),
      expect.stringMatching(/^Firebase Storage: /),
    ]);
  });
});
