import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { envValidationSchema } from './env.validation';

/**
 * 32-doc §5 test 3 — the self-loop guard is only as real as its variable.
 *
 * **This test exists because the failure is silent and total.** The guard is
 * "ignore mail from our own sending address"; read from a variable this process
 * does not define, the comparison is against `undefined`, every message passes
 * it, and the guard fails OPEN into exactly the unbounded loop it was written
 * to stop. Nothing logs, because from the code's point of view no mail was ever
 * from us.
 *
 * `EMAIL_SENDER` was notification-service's alone until 31-doc §6 moved the
 * guard to the gateway, which is the whole reason this can be forgotten.
 */
describe('the gateway’s inbound-email configuration', () => {
  /**
   * The REAL `.env.test`, parsed.
   *
   * Synthesising a valid env by hand was the first attempt and it failed for
   * unrelated keys — `BUILD_TIME` wants ISO, `COOKIE_SAMESITE` an enum — which
   * would have made the control case red for reasons that say nothing about
   * inbound email. Reading the file the suite actually boots with proves two
   * things at once: the schema accepts it, and it defines these three.
   */
  const baseline = (): Record<string, string> =>
    Object.fromEntries(
      readFileSync(join(__dirname, '../../../.env.test'), 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#') && line.includes('='))
        .map((line) => {
          const at = line.indexOf('=');

          return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
        }),
    );

  const validate = (env: Record<string, string>) =>
    envValidationSchema.validate(env, {
      allowUnknown: true,
      abortEarly: false,
    });

  it('the baseline env is valid — otherwise every case below is meaningless', () => {
    expect(validate(baseline()).error).toBeUndefined();
  });

  it.each(['EMAIL_SENDER', 'INBOUND_EMAIL_SECRET', 'INBOUND_EMAIL_DOMAIN'])(
    '**refuses to boot without %s**',
    (key) => {
      const env = baseline();

      // Present in the file at all is half the assertion: the guard cannot be
      // forgotten in `.env.test` without this failing.
      expect(env[key]).toBeDefined();
      delete env[key];

      expect(validate(env).error?.message).toContain(key);
    },
  );
});
