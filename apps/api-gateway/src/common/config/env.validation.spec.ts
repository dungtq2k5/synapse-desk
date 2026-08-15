import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { envValidationSchema } from './env.validation';
import { extractEmailAddress } from '@synapsedesk/common';

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
   * Synthesizing a valid env by hand was the first attempt and it failed for
   * unrelated keys — `BUILD_TIME` wants ISO, `COOKIE_SAMESITE` an enum — which
   * would have made the control case red for reasons that say nothing about
   * inbound email. Reading the file the suite actually boots with proves two
   * things at once: the schema accepts it, and it defines these three.
   */
  const envFile = (path: string): Record<string, string> =>
    Object.fromEntries(
      readFileSync(join(__dirname, path), 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#') && line.includes('='))
        .map((line) => {
          const at = line.indexOf('=');

          return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
        }),
    );

  const baseline = (): Record<string, string> => envFile('../../../.env.test');

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

  /**
   * **Defined is only half of it — it has to be the RIGHT address.**
   *
   * The test above proves the gateway refuses to boot without `EMAIL_SENDER`,
   * and that is exactly as far as it goes. notification-service is what
   * actually sends, so if the two name different mailboxes the guard compares
   * every inbound `From` against an address nothing ever sends from: it fails
   * OPEN, nothing logs, and 31-doc §7's unbounded loop is reachable again. The
   * previous state of these files was precisely that — `support@synapsedesk.test`
   * here against `noreply@synapsedesk.com` there — and every existing test
   * passed, because each one only ever read its own side.
   *
   * Compared through the guard's own {@link extractEmailAddress}, not a second
   * spelling of it: `.env` wraps this address in a display name and the two
   * services word theirs differently, which is decoration rather than
   * disagreement. A local re-implementation here would be a test that agrees
   * with itself.
   */
  it('**and names the same sending address notification-service does**', () => {
    const gateway = baseline().EMAIL_SENDER;
    const notification = envFile(
      '../../../../notification-service/.env.test',
    ).EMAIL_SENDER;

    expect(notification).toBeDefined();
    expect(extractEmailAddress(gateway)).toBe(
      extractEmailAddress(notification),
    );
  });
});
