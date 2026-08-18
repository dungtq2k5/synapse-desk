import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AI_MODEL_TIERS,
  AI_RETRIEVAL_DEFAULTS,
  AI_SETTINGS_CLAMPS,
  ALL_CONFIGURED_MODELS,
  CHEAP_MODEL,
  DEFAULT_AI_MODEL_TIER,
  EMBEDDING_MODEL,
  GENERATION_MODEL_BY_TIER,
  asAiModelTier,
  clampAiSetting,
  resolveAiSettings,
} from './ai-settings.config';
import { assertPricingTableCovers, MODEL_PRICING } from './ai-pricing.config';

describe('B AI settings (unit)', () => {
  /**
   * Read rather than imported, so this spec fails when the JSON and the TS
   * disagree instead of when TypeScript cannot resolve the module. `resolveJson-
   * Module` would also bake the file into `dist/`, which is precisely what the
   * fixture's header says it must not be — it is a test artifact, not a runtime
   * dependency of either service.
   */
  const contract = JSON.parse(
    readFileSync(join(__dirname, 'ai-settings.contract.json'), 'utf8'),
  ) as {
    cheapModel: string;
    embeddingModel: string;
    generationModelByTier: Record<string, string>;
    defaultTier: string;
    retrievalDefaults: Record<string, number>;
    clamps: Record<string, { min: number; max: number }>;
  };

  describe('resolveAiSettings', () => {
    it('1. Resolves global DEFAULTS with no tier and no overrides', () => {
      const settings = resolveAiSettings(DEFAULT_AI_MODEL_TIER);

      expect(settings).toEqual({
        generationModel: GENERATION_MODEL_BY_TIER.FAST,
        cheapModel: CHEAP_MODEL,
        embeddingModel: EMBEDDING_MODEL,
        ...AI_RETRIEVAL_DEFAULTS,
      });
    });

    it('2. Changes generationModel and NOTHING else when the tier is QUALITY', () => {
      // The row that catches the plausible-sounding extension: scaling the
      // embedding model with the tier is a full re-embed migration of every
      // tenant, and scaling the cheap model multiplies a premium
      // tenant's bill on volume calls nobody can tell apart.
      const fast = resolveAiSettings('FAST');
      const quality = resolveAiSettings('QUALITY');

      expect(quality.generationModel).not.toBe(fast.generationModel);
      expect(quality.generationModel).toBe(GENERATION_MODEL_BY_TIER.QUALITY);

      // Compared as a whole rather than field by field, so a setting added
      // later is covered by this assertion without anyone remembering to
      // extend it — which is the only way a rule like "the tier changes
      // exactly one thing" survives contact with a growing settings object.
      expect({ ...quality, generationModel: fast.generationModel }).toEqual(
        fast,
      );
    });

    it('3. Prices the QUALITY model HIGHER, which is what makes the tier safe to sell', () => {
      // A QUALITY tenant consumes the same token count for
      // several times the money. Because the budget is denominated in cost
      // rather than tokens, their spend rises accordingly and the cap keeps
      // meaning what it meant. Equal prices here would silently restore the
      // token-budgeting failure the ledger was designed to avoid.
      const fast = MODEL_PRICING[GENERATION_MODEL_BY_TIER.FAST];
      const quality = MODEL_PRICING[GENERATION_MODEL_BY_TIER.QUALITY];

      expect(quality.promptMicrosPerMillion).toBeGreaterThan(
        fast.promptMicrosPerMillion,
      );
      expect(quality.completionMicrosPerMillion).toBeGreaterThan(
        fast.completionMicrosPerMillion,
      );
    });
  });

  describe('clamps', () => {
    it('4. CLAMPS an out-of-range value rather than throwing', () => {
      // A throw would fail a tenant's request over a configuration mistake
      // that has a perfectly serviceable safe answer — and the bound is that
      // answer. Refusing to serve is the right response to a bad tenant
      // boundary, not to a topN of 5000.
      expect(clampAiSetting('topN', 5_000)).toBe(AI_SETTINGS_CLAMPS.topN.max);
      expect(clampAiSetting('topN', -1)).toBe(AI_SETTINGS_CLAMPS.topN.min);
      expect(clampAiSetting('finalContextK', 999)).toBe(
        AI_SETTINGS_CLAMPS.finalContextK.max,
      );
    });

    it('5. Falls back to the default for NaN, which no comparison would catch', () => {
      // NaN compares false against everything, so Math.min/Math.max return it
      // untouched — it would pass straight through a clamp that looked correct
      // and land in a prompt size or a threshold.
      expect(clampAiSetting('topN', Number.NaN)).toBe(
        AI_RETRIEVAL_DEFAULTS.topN,
      );
      expect(
        clampAiSetting('escalationThreshold', Number.POSITIVE_INFINITY),
      ).toBe(AI_SETTINGS_CLAMPS.escalationThreshold.max);
    });

    it('6. Leaves every shipped default UNTOUCHED', () => {
      // A default outside its own clamp is a contradiction that would surface
      // as a value nobody configured, so the two tables are asserted
      // consistent rather than assumed to be.
      for (const key of Object.keys(AI_RETRIEVAL_DEFAULTS) as Array<
        keyof typeof AI_RETRIEVAL_DEFAULTS
      >) {
        expect(clampAiSetting(key, AI_RETRIEVAL_DEFAULTS[key])).toBe(
          AI_RETRIEVAL_DEFAULTS[key],
        );
      }
    });

    it('7. Clamps EVERY numeric setting, so a new one cannot ship unbounded', () => {
      expect(Object.keys(AI_SETTINGS_CLAMPS).sort()).toEqual(
        Object.keys(AI_RETRIEVAL_DEFAULTS).sort(),
      );
    });
  });

  describe('pricing coverage', () => {
    it('8. Prices every model the settings layer can RESOLVE', () => {
      // The boot check, asserted against the real configured set rather than a
      // hand-written list — an unpriced model meters as free, and a list that
      // drifted from the mapping would be the way that happens.
      expect(() =>
        assertPricingTableCovers(ALL_CONFIGURED_MODELS),
      ).not.toThrow();
      expect(ALL_CONFIGURED_MODELS).toContain(CHEAP_MODEL);
      expect(ALL_CONFIGURED_MODELS).toContain(EMBEDDING_MODEL);
    });
  });

  describe('tier narrowing', () => {
    it('9. Falls back to the default tier for an UNKNOWN value', () => {
      // The tier arrives from another service's column. A typo or a value from
      // a newer deployment must degrade to the cheap tier, never to undefined
      // — which would index the mapping to `undefined` and hand a model name
      // of `undefined` to the pricing table.
      expect(asAiModelTier('NONSENSE')).toBe(DEFAULT_AI_MODEL_TIER);
      expect(asAiModelTier(null)).toBe(DEFAULT_AI_MODEL_TIER);
      expect(asAiModelTier(undefined)).toBe(DEFAULT_AI_MODEL_TIER);
      expect(asAiModelTier('QUALITY')).toBe('QUALITY');
    });

    it('10. Maps EVERY tier to a model, so no tier resolves to undefined', () => {
      for (const tier of AI_MODEL_TIERS) {
        expect(typeof GENERATION_MODEL_BY_TIER[tier]).toBe('string');
      }
    });
  });

  describe('cross-language contract', () => {
    // The Python half of this same assertion lives in
    // `apps/rag-service/tests/test_settings.py`; between them, a value changed
    // on one side and not the other fails that side's own suite.
    it('11. Matches the SHARED contract fixture the Python resolver also reads', () => {
      expect(CHEAP_MODEL).toBe(contract.cheapModel);
      expect(EMBEDDING_MODEL).toBe(contract.embeddingModel);
      expect(GENERATION_MODEL_BY_TIER).toEqual(contract.generationModelByTier);
      expect(DEFAULT_AI_MODEL_TIER).toBe(contract.defaultTier);
      expect(AI_RETRIEVAL_DEFAULTS).toEqual(contract.retrievalDefaults);
      expect(AI_SETTINGS_CLAMPS).toEqual(contract.clamps);
    });

    it('12. Produces settings identical to the contract for EVERY tier', () => {
      // Stronger than comparing the tables field by field: it compares the
      // resolver's OUTPUT, so a divergence in how one side assembles those
      // tables is caught even when every table matches.
      for (const tier of AI_MODEL_TIERS) {
        expect(resolveAiSettings(tier)).toEqual({
          generationModel: contract.generationModelByTier[tier],
          cheapModel: contract.cheapModel,
          embeddingModel: contract.embeddingModel,
          ...contract.retrievalDefaults,
        });
      }
    });
  });
});
