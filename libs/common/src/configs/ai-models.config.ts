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
 * const model: AiModel = 'gemini-2.5-pro';
 */
export const AI_MODELS = [
  'gemini-2.5-pro',
  'gemini-3.5-flash-lite',
  'gemini-embedding-2',
] as const;

export type AiModel = (typeof AI_MODELS)[number];
