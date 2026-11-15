/** @file The model catalogue both the tier settings and the price table key off. */

/**
 * Every model this system may be configured to call.
 *
 * One list so the three places that name a model cannot drift: the tier map and
 * the tier-independent constants in `ai-settings.config.ts`, and `MODEL_PRICING`
 * in `ai-pricing.config.ts`. `MODEL_PRICING` is `Record<AiModel, …>`, so adding a
 * member here fails to compile until it has a price — which is the check that
 * used to run at boot, moved to the compiler.
 *
 * @example
 * const model: AiModel = 'gemini-4-argon';
 */
export const AI_MODELS = [
  'gemini-4-argon',
  'gemini-3.5-flash-lite',
  'gemini-embedding-2',
  'qwen2.5:7b-instruct-q4_K_M',
  'qwen2.5:3b-instruct-q4_K_M',
  'nomic-embed-text:v1.5',
] as const;

export type AiModel = (typeof AI_MODELS)[number];

/**
 * Who serves a model: Google's API, or an Ollama server
 * (`OLLAMA_BASE_URL`). Chosen per role by `AI_GENERATION_PROVIDER` and
 * `AI_EMBEDDING_PROVIDER`.
 */
export const AI_PROVIDERS = ['gemini', 'ollama'] as const;

export type AiProvider = (typeof AI_PROVIDERS)[number];

/**
 * The digest each Ollama tag must resolve to, as `/api/tags` reports it.
 *
 * A tag is a name, and a re-pull can point it at different weights; the
 * digest is the weights. The boot check and `npm run ai:check-local` refuse a
 * server whose tag resolves to anything else, so a baseline measured on these
 * weights can't silently be compared against others.
 *
 * @example
 * OLLAMA_MODEL_DIGESTS['nomic-embed-text:v1.5'] // '0a109f42…'
 */
export const OLLAMA_MODEL_DIGESTS = {
  'qwen2.5:7b-instruct-q4_K_M':
    '845dbda0ea48ed749caafd9e6037047aa19acfcfd82e704d7ca97d631a0b697e',
  'qwen2.5:3b-instruct-q4_K_M':
    '357c53fb659c5076de1d65ccb0b397446227b71a42be9d1603d46168015c9e4b',
  'nomic-embed-text:v1.5':
    '0a109f422b47e3a30ba2b10eca18548e944e8a23073ee3f3e947efcf3c45e59f',
} as const satisfies Partial<Record<AiModel, string>>;
