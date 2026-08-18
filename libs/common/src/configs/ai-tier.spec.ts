import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_PLAN_CATALOG,
  GENERATION_MODEL_BY_TIER,
  MODEL_PRICING,
  entitlementsForPrice,
  estimateCostMicros,
} from '../main';

const REPO_ROOT = join(__dirname, '../../../..');

describe('The AI tier (unit)', () => {
  describe('what makes it safe to sell', () => {
    it('1. Prices QUALITY above FAST, so the CAP keeps meaning what it meant', () => {
      // Under TOKEN budgeting, a premium tenant consumes the same token count
      // for several times the money and the budget stops protecting margin.
      // Cost metering (RDM §1.14) is what closed that door before it cost
      // anything, and it is the only reason the tier is sellable at all.
      const fast = MODEL_PRICING[GENERATION_MODEL_BY_TIER.FAST];
      const quality = MODEL_PRICING[GENERATION_MODEL_BY_TIER.QUALITY];

      expect(quality.promptMicrosPerMillion).toBeGreaterThan(
        fast.promptMicrosPerMillion,
      );
      expect(quality.completionMicrosPerMillion).toBeGreaterThan(
        fast.completionMicrosPerMillion,
      );
    });

    it('2. Charges MORE for identical token counts on the premium tier', () => {
      // The commercial consequence in one line: same usage, more money, so a
      // QUALITY tenant reaches the cap sooner.
      const fast = estimateCostMicros(
        GENERATION_MODEL_BY_TIER.FAST,
        1_000,
        200,
      );
      const quality = estimateCostMicros(
        GENERATION_MODEL_BY_TIER.QUALITY,
        1_000,
        200,
      );

      expect(quality).toBeGreaterThan(fast);
    });
  });

  describe('the plan catalog', () => {
    it('3. Grants a tier on every plan, and QUALITY on at least one', () => {
      // A catalog where nothing grants QUALITY is a tier nobody can buy — the
      // feature would ship, pass every other test, and be unsellable.
      const tiers = Object.values(DEFAULT_PLAN_CATALOG).map(
        (plan) => plan.aiModelTier,
      );

      expect(tiers.every(Boolean)).toBe(true);
      expect(tiers).toContain('QUALITY');
      expect(tiers).toContain('FAST');
    });

    it('4. Prices every model a plan can grant', () => {
      // A plan granting an unpriced model meters as free for whoever buys it —
      // the most expensive possible version of the pricing-table hole.
      for (const plan of Object.values(DEFAULT_PLAN_CATALOG)) {
        expect(
          MODEL_PRICING[GENERATION_MODEL_BY_TIER[plan.aiModelTier]],
        ).toBeDefined();
      }
    });

    it('5. Returns NULL for an unknown price rather than a default plan', () => {
      // Fail closed. Defaulting to the free tier means one dashboard typo
      // downgrades a paying customer with no error anywhere.
      expect(
        entitlementsForPrice(DEFAULT_PLAN_CATALOG, 'price_typo'),
      ).toBeNull();
      expect(entitlementsForPrice(DEFAULT_PLAN_CATALOG, undefined)).toBeNull();
    });
  });

  describe('Ticket-service names no model', () => {
    it('6. Contains no model-name literal ANYWHERE', () => {
      // Applied to the service that should never have one. `ticket-service`
      // calls rag-service, which resolves settings itself — so this service
      // never sees a model name as an input, which is the easiest possible
      // version of the model-literal rule. The check is repo-wide; this asserts it for the one
      // service the doc calls out by name.
      const output = execFileSync(
        process.execPath,
        [join(REPO_ROOT, 'scripts/check-model-literals.mjs')],
        { encoding: 'utf8' },
      );

      expect(output).toContain('No model-name literals');
    });

    it('7. Takes no model name as an INPUT on any co-pilot call', () => {
      // The subtler version the lint cannot see: a `modelName` PARAMETER would
      // let a caller pick the premium tier for free. `modelName`
      // appears only as an output field, never as something passed in.
      const source = readFileSync(
        join(
          REPO_ROOT,
          'apps/ticket-service/src/modules/ai-client/rag-client.service.ts',
        ),
        'utf8',
      );

      const parameterLists = [...source.matchAll(/\(([^)]*)\)\s*:\s*Promise</g)]
        .map((match) => match[1])
        .join(' ');

      expect(parameterLists).not.toMatch(/model/i);
    });
  });
});
