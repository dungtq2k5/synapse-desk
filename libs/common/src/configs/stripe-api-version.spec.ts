import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STRIPE_API_VERSION } from './billing.config';

/**
 * The version is in THREE places and must be one number.
 *
 * `stripe.service.ts` imports the constant, but the two provisioning scripts
 * are `.mjs` run by `node` outside the TypeScript build and cannot — so they
 * carry the literal. That is the drift this pins: the scripts CREATE the
 * Products, Prices and portal configuration the service then READS, and two
 * API versions across that boundary is a shape mismatch nobody sees until a
 * field is missing from an object somebody already created.
 */
describe('The pinned Stripe API version', () => {
  const REPO = join(__dirname, '../../../..');
  const SCRIPTS = ['scripts/provision-stripe.mjs', 'scripts/seed-plans.mjs'];

  it('1. **the scan reads the scripts it claims to check**', () => {
    // The vacuity guard. A path that stops resolving makes every assertion
    // below pass by reading nothing — and this file's whole job is reading.
    for (const script of SCRIPTS) {
      const source = readFileSync(join(REPO, script), 'utf8');

      expect(source.length).toBeGreaterThan(500);
      expect(source).toContain('new Stripe(');
    }
  });

  it('2. **every script pins the SAME version the service does**', () => {
    for (const script of SCRIPTS) {
      const source = readFileSync(join(REPO, script), 'utf8');
      const pinned = source.match(/apiVersion:\s*'([^']+)'/)?.[1];

      // Absent is a failure too: an unpinned script inherits whatever the
      // account default happens to be, which is the thing being prevented.
      expect(pinned).toBe(STRIPE_API_VERSION);
    }
  });

  it('3. the constant looks like a Stripe version, not a placeholder', () => {
    expect(STRIPE_API_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}(\.\w+)?$/);
  });
});
