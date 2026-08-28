import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FREE_PLAN_SEED,
  FREE_TIER_ENTITLEMENTS,
  FREE_TIER_ORGANIZATION_GRANTS,
} from './billing.config';
import {
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENTS_PER_TENANT,
} from './document.config';
import { MAX_ATTACHMENT_BYTES } from './ticket.config';
import { MAX_ANALYTICS_RANGE_DAYS } from './analytics.config';

/**
 * The free tier's actual NUMBERS, pinned.
 *
 * **The one place duplicating them is right**, and the reason is that every
 * other test asserts against the constant — which is correct for proving the
 * create paths use it, and makes those tests structurally incapable of noticing
 * the constant CHANGING. Editing the free tier should be a deliberate act with
 * a diff somebody reviews, not something that rides along in a refactor.
 *
 * So: this file fails when the product decision changes, and updating it is how
 * you record that you meant to.
 */
describe('The free tier', () => {
  it('1. **is these numbers** — change them here on purpose or not at all', () => {
    expect(FREE_TIER_ENTITLEMENTS).toEqual({
      maxAgentSeats: 10,
      maxStorageBytes: 5_368_709_120n,
      monthlyAiTokenBudget: 1_000_000n,
      aiModelTier: 'FAST',
      displayName: 'Free',
      maxDocumentBytes: 104_857_600n,
      maxAttachmentBytes: 10_485_760n,
      maxDocumentUploads: 100_000,
      maxAnalyticsRangeDays: 400,
    });
  });

  it('2. **four of them still track the platform constants they used to copy**', () => {
    // These were literal copies in `schema.prisma`, with the staleness hazard
    // the plan grants document: raise the constant and every new tenant stays
    // at the old number, with no error anywhere. Referencing removed the drift;
    // this is what stops somebody re-introducing it by pasting a literal.
    expect(FREE_TIER_ENTITLEMENTS.maxDocumentBytes).toBe(
      BigInt(MAX_DOCUMENT_BYTES),
    );
    expect(FREE_TIER_ENTITLEMENTS.maxAttachmentBytes).toBe(
      BigInt(MAX_ATTACHMENT_BYTES),
    );
    expect(FREE_TIER_ENTITLEMENTS.maxDocumentUploads).toBe(
      MAX_DOCUMENTS_PER_TENANT,
    );
    expect(FREE_TIER_ENTITLEMENTS.maxAnalyticsRangeDays).toBe(
      MAX_ANALYTICS_RANGE_DAYS,
    );
  });

  it('2b. **…and REFERENCES them, rather than happening to equal them**', () => {
    // Measured: test 2 passes for a re-inlined literal, because the literal and
    // the constant are the same number TODAY. That is exactly the staleness
    // hazard this work removed — the drift only appears when the constant moves,
    // which is the moment nobody is looking.
    //
    // No runtime assertion can tell "references" from "coincides", so this one
    // reads the source. Same shape as the other structural guards in this repo,
    // and the same reason: the property is about the code, not the values.
    const source = readFileSync(join(__dirname, 'billing.config.ts'), 'utf8');

    // The vacuity guard: a path that stops resolving, or a constant that gets
    // renamed, would otherwise make every check below pass over nothing.
    expect(source).toContain('export const FREE_TIER_ENTITLEMENTS');

    for (const constant of [
      'MAX_DOCUMENT_BYTES',
      'MAX_ATTACHMENT_BYTES',
      'MAX_DOCUMENTS_PER_TENANT',
      'MAX_ANALYTICS_RANGE_DAYS',
    ]) {
      expect(source).toMatch(new RegExp(`max\\w+:\\s*(BigInt\\()?${constant}`));
    }
  });

  it('3. **the free grant EQUALS the platform ceiling on four dimensions**', () => {
    // Recorded rather than asserted away. "The most the system permits" and
    // "what you get for free" are different questions that currently have the
    // same answer on these four — which is the open product decision this work
    // surfaced. When somebody narrows one, this test is what they edit, and
    // editing it is how the decision gets noticed.
    expect(Number(FREE_TIER_ENTITLEMENTS.maxDocumentBytes)).toBe(
      MAX_DOCUMENT_BYTES,
    );
    expect(FREE_TIER_ENTITLEMENTS.maxDocumentUploads).toBe(
      MAX_DOCUMENTS_PER_TENANT,
    );
  });

  it('4. **the organization grants are the entitlements minus the label**', () => {
    // `displayName` is a PLAN's field; `organizations` has no such column, and
    // a spread carrying it fails at runtime because TypeScript cannot see an
    // excess property through a spread. The two shapes overlap and are not
    // equal, and this pins the difference to exactly one field.
    const { displayName, ...withoutLabel } = FREE_TIER_ENTITLEMENTS;

    expect(displayName).toBe('Free');
    expect(FREE_TIER_ORGANIZATION_GRANTS).toEqual(withoutLabel);
    expect(FREE_TIER_ORGANIZATION_GRANTS).not.toHaveProperty('displayName');
  });

  it('5. the Free PLAN row is seeded from the same numbers', () => {
    // A second copy in the seeder would let the catalogue and the tenants
    // disagree about what free is.
    expect(FREE_PLAN_SEED.name).toBe(FREE_TIER_ENTITLEMENTS.displayName);
    expect(FREE_PLAN_SEED.maxAgentSeats).toBe(
      FREE_TIER_ENTITLEMENTS.maxAgentSeats,
    );
    expect(FREE_PLAN_SEED.maxAnalyticsRangeDays).toBe(
      FREE_TIER_ENTITLEMENTS.maxAnalyticsRangeDays,
    );
    // Assigned, never sold.
    expect(FREE_PLAN_SEED.stripeProductId).toBeNull();
  });
});
