/**
 * **The only place in the TypeScript codebase where a model name may appear.**
 *
 * Doc 15 §1.2 states the rule and this file is the exception it carves out:
 * no model name in a service, a prompt builder, a test fixture, or a config
 * read at a call site. The failure mode is quiet and expensive — a single
 * `'gemini-2.0-flash'` typed into a summarizer is a tenant on the premium tier
 * silently receiving the cheap model. Nothing errors; the answer is merely
 * worse, for the customer paying more.
 *
 * `scripts/check-model-literals.mjs` makes that rule mechanical rather than
 * aspirational, and this file plus `ai-pricing.config.ts` are its allowlist.
 * The pricing table is a second legitimate home for the names because it is
 * keyed BY model rather than choosing one — it answers "what does X cost",
 * never "which model do we use".
 *
 * The values here are mirrored in `rag_service/settings.py`, and the mirror is
 * held honest by `ai-settings.contract.json` — see the note on that file.
 */

/**
 * The tier a tenant's generation model is resolved from.
 *
 * Present before anything writes it, which is deliberate: doc 15 §2.1 makes
 * this one column set by the Stripe webhook, and the point of building the
 * resolver first is that landing the tier is then a data change rather than a
 * refactor. Until billing ships every tenant resolves to `FAST` — but through
 * the mapping below, not around it.
 */
export const AI_MODEL_TIERS = ['FAST', 'QUALITY'] as const;
export type AiModelTier = (typeof AI_MODEL_TIERS)[number];

export const DEFAULT_AI_MODEL_TIER: AiModelTier = 'FAST';

/**
 * What a tenant's AI request is allowed to know about models and retrieval.
 *
 * Everything downstream — both services, both languages — reads its values
 * from here and nothing else. Note what is absent: no endpoint takes a model
 * name today, and none would once tiers ship, which is the property that keeps
 * step 3 of the resolution order (per-tenant overrides) additive.
 */
export type AiSettings = {
  /** Resolved from the tier. The ONLY tier-varying value — doc 15 §2.2. */
  generationModel: string;
  /** Greeting classification and reformulation. Deliberately tier-INdependent. */
  cheapModel: string;
  /** Never tenant-varying: a Qdrant collection fixes dimension at creation. */
  embeddingModel: string;
  /** RRF weight on the semantic arm. */
  semanticWeight: number;
  /** RRF weight on the lexical arm. */
  lexicalWeight: number;
  /** Candidates requested from EACH arm — never scaled per arm (11-doc §1.5). */
  topN: number;
  /** How many chunks survive rerank and reach the prompt. */
  finalContextK: number;
  /** Below this rerank score, the answer is `DOC_MISSING` rather than a guess. */
  escalationThreshold: number;
  /** Co-RAG review passes. `0` on the streamed hot path, `1-2` for the co-pilot. */
  coRagMaxRetries: number;
};

/**
 * Tier -> generation model. **This mapping is the entire tier feature.**
 *
 * Doc 15 §2.1: once the Stripe webhook writes `organizations.ai_model_tier`,
 * shipping tiers is this table being read with a real value instead of the
 * default. Nothing else moves, which is the whole return on building the
 * resolver now.
 */
export const GENERATION_MODEL_BY_TIER: Record<AiModelTier, string> = {
  FAST: 'gemini-2.0-flash',
  QUALITY: 'gemini-2.5-pro',
};

/**
 * The tier-independent models.
 *
 * `cheapModel` does not scale with the tier on purpose (doc 15 §2.2): greeting
 * classification and reformulation are volume calls whose quality barely moves
 * with model tier, so scaling them multiplies a premium tenant's bill for no
 * perceptible gain.
 *
 * `embeddingModel` is not merely tier-independent but tenant-independent.
 * Per-tenant embedding models force per-tenant collections and make every tier
 * change a full re-embed migration (11-doc §1.3). It is stated here as a
 * constant rather than a setting anyone could vary.
 */
export const CHEAP_MODEL = 'gemini-2.0-flash-lite';
export const EMBEDDING_MODEL = 'text-embedding-004';

/** Every model the system can be configured to use — for the boot-time price check. */
export const ALL_CONFIGURED_MODELS: string[] = [
  ...Object.values(GENERATION_MODEL_BY_TIER),
  CHEAP_MODEL,
  EMBEDDING_MODEL,
];

/**
 * The retrieval defaults, from `docs/rag/`.
 *
 * These are guesses in the honest sense — there is no eval set yet, which is
 * exactly why 11-doc §1.7 keeps them out of tenant hands. They live here so
 * that when there IS an eval set, tuning them is editing one table rather than
 * finding every call site that hardcoded a `k`.
 */
export const AI_RETRIEVAL_DEFAULTS = {
  semanticWeight: 0.6,
  lexicalWeight: 0.4,
  topN: 20,
  finalContextK: 5,
  escalationThreshold: 0.3,
  coRagMaxRetries: 0,
} as const;

/**
 * Server-side bounds on every numeric setting — doc 15 §1.4.
 *
 * Applied whether or not tenants can currently set anything, because the cost
 * of the clamp is one line now and the cost of its absence is an incident: an
 * unclamped `finalContextK` is a direct path to enormous prompts and a blown
 * budget, and the value that gets there does not have to arrive from a tenant.
 * A bad default, a migration typo or a future override all take the same path.
 */
export const AI_SETTINGS_CLAMPS: Record<
  keyof typeof AI_RETRIEVAL_DEFAULTS,
  { min: number; max: number }
> = {
  semanticWeight: { min: 0, max: 1 },
  lexicalWeight: { min: 0, max: 1 },
  topN: { min: 1, max: 100 },
  finalContextK: { min: 1, max: 20 },
  escalationThreshold: { min: 0, max: 1 },
  coRagMaxRetries: { min: 0, max: 3 },
};

/**
 * Forces a value into range. **Clamps rather than throwing** — deliberately.
 *
 * A throw here fails a tenant's request over a configuration mistake that has
 * a perfectly serviceable safe answer. The bound IS the safe answer, so the
 * request proceeds with it and the caller logs the correction. Refusing to
 * serve is the right response to a bad tenant boundary, not to a `topN` of
 * 5000.
 */
export function clampAiSetting(
  key: keyof typeof AI_RETRIEVAL_DEFAULTS,
  value: number,
): number {
  const { min, max } = AI_SETTINGS_CLAMPS[key];

  // NaN, and ONLY NaN, is special-cased. It compares false against everything,
  // so it survives Math.min/Math.max untouched and would propagate silently
  // into a prompt size or a threshold. Infinity needs no such handling — it is
  // perfectly ordered, so the clamp already resolves it to the bound, which is
  // the same safe answer any other out-of-range value gets.
  if (Number.isNaN(value)) return AI_RETRIEVAL_DEFAULTS[key];

  return Math.min(max, Math.max(min, value));
}

/**
 * Resolution steps 1 and 2 of doc 15 §1.1, and in v1 there are only two.
 *
 * Step 3 — per-tenant overrides from `organization_ai_settings` — is additive
 * by construction: it would clamp a partial override over this result, and no
 * caller signature changes because no caller passes a model name today.
 *
 * Pure, synchronous and I/O-free on purpose. The caching, the tier lookup and
 * the invalidation all belong to the service wrapping this in each language;
 * what is shared across the two languages is exactly this function, which is
 * what makes the contract fixture a meaningful comparison.
 */
export function resolveAiSettings(tier: AiModelTier): AiSettings {
  return {
    generationModel: GENERATION_MODEL_BY_TIER[tier],
    cheapModel: CHEAP_MODEL,
    embeddingModel: EMBEDDING_MODEL,
    semanticWeight: clampAiSetting(
      'semanticWeight',
      AI_RETRIEVAL_DEFAULTS.semanticWeight,
    ),
    lexicalWeight: clampAiSetting(
      'lexicalWeight',
      AI_RETRIEVAL_DEFAULTS.lexicalWeight,
    ),
    topN: clampAiSetting('topN', AI_RETRIEVAL_DEFAULTS.topN),
    finalContextK: clampAiSetting(
      'finalContextK',
      AI_RETRIEVAL_DEFAULTS.finalContextK,
    ),
    escalationThreshold: clampAiSetting(
      'escalationThreshold',
      AI_RETRIEVAL_DEFAULTS.escalationThreshold,
    ),
    coRagMaxRetries: clampAiSetting(
      'coRagMaxRetries',
      AI_RETRIEVAL_DEFAULTS.coRagMaxRetries,
    ),
  };
}

/** Narrows an untrusted string to a tier, falling back to the default. */
export function asAiModelTier(value: string | null | undefined): AiModelTier {
  return AI_MODEL_TIERS.includes(value as AiModelTier)
    ? (value as AiModelTier)
    : DEFAULT_AI_MODEL_TIER;
}
