import {
  AiSurface,
  AT_CAP_POLICY,
  AtCapAction,
  assertPricingTableCovers,
  estimateCostMicros,
  MODEL_PRICING,
  pricingFor,
  QUOTA_ALERT_THRESHOLDS,
  quotaCounterKey,
  quotaThresholdEventId,
} from './ai-pricing.config';
import {
  EMBEDDING_MODEL,
  GENERATION_MODEL_BY_TIER,
} from './ai-settings.config';

/**
 * The pricing table and the quota key, tested where they are DEFINED.
 *
 * Two of these matter more than the rest:
 *
 *   - **the startup check** (§1.3 test 6), because an unpriced model discovered
 *     at first use has already been billed as free at least once, and the whole
 *     point is that it never is;
 *   - **the key format** (§1.3 test 9), because it is about to have a second
 *     implementation in Python and the two must agree byte for byte.
 */
describe('the model pricing table (unit)', () => {
  it('fails at STARTUP for an unpriced model — §1.3 test 6', () => {
    // Not at first use, when it would meter as free and report a tenant
    // comfortably under budget while they spent freely.
    expect(() =>
      assertPricingTableCovers([
        GENERATION_MODEL_BY_TIER.FAST,
        'some-model-nobody-priced',
      ]),
    ).toThrow(/some-model-nobody-priced/);
  });

  it('names EVERY missing model, not just the first', () => {
    // An operator fixing config wants the whole list in one boot, not one
    // restart per missing entry.
    const thrown = (() => {
      try {
        assertPricingTableCovers(['alpha-missing', 'beta-missing']);
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    })();

    expect(thrown).toContain('alpha-missing');
    expect(thrown).toContain('beta-missing');
  });

  it('passes silently when every model is priced', () => {
    expect(() =>
      assertPricingTableCovers(Object.keys(MODEL_PRICING)),
    ).not.toThrow();
  });

  it('THROWS rather than returning zero for an unknown model', () => {
    // The difference between a loud failure and a silent metering hole. A
    // lookup returning `{0, 0}` would make every call on that model free.
    expect(() => pricingFor('not-a-model')).toThrow(/No pricing for model/);
  });

  it('prices every entry with a non-negative prompt rate', () => {
    // A zero PROMPT rate would make a whole model free. A zero COMPLETION rate
    // is legitimate — an embedding model has no completion side — so only the
    // prompt side is required to be positive.
    for (const [model, pricing] of Object.entries(MODEL_PRICING)) {
      expect([model, pricing.promptMicrosPerMillion > 0]).toEqual([
        model,
        true,
      ]);
      expect([model, pricing.completionMicrosPerMillion >= 0]).toEqual([
        model,
        true,
      ]);
    }
  });

  it('charges DIFFERENT money for the same tokens on different models', () => {
    // The reason the budget is denominated in money rather than tokens: cost
    // per token varies MATERIALLY across tiers, so a token budget stops meaning
    // anything the moment model choice becomes sellable.
    //
    // **The multiple is a floor, not a measurement.** It was 5x when FAST was
    // `gemini-2.0-flash`; it is ~4x now that FAST is `gemini-3.5-flash-lite`
    // against `gemini-2.5-pro`, and it will move again with every repin. What
    // must not change is the ORDER — a FAST tenant burning a money-denominated
    // cap faster than a premium one would make the tier unsellable, and
    // `ai-settings.config.spec.ts` asserts that direction separately.
    const fast = estimateCostMicros(
      GENERATION_MODEL_BY_TIER.FAST,
      1_000_000,
      1_000_000,
    );
    const quality = estimateCostMicros(
      GENERATION_MODEL_BY_TIER.QUALITY,
      1_000_000,
      1_000_000,
    );

    expect(quality).toBeGreaterThan(fast * 3n);
  });

  it('rounds UP, never down', () => {
    // A fractional micro rounded down on every call under-counts
    // systematically, and the direction matters: an under-count lets a tenant
    // spend past their cap. An over-count of at most one micro per call costs
    // nobody anything measurable.
    //
    // One token at 100,000 micros/million is 0.1 micros — which must not floor
    // to zero, or a million single-token calls would be free.
    expect(estimateCostMicros(GENERATION_MODEL_BY_TIER.FAST, 1, 0)).toBe(1n);
  });

  it('charges nothing for a zero-token call', () => {
    expect(estimateCostMicros(GENERATION_MODEL_BY_TIER.FAST, 0, 0)).toBe(0n);
  });

  it('charges an EMBEDDING only on the prompt side', () => {
    // `completionTokens` is always 0 for an embedding, so a non-zero completion
    // rate would be unreachable and misleading.
    expect(estimateCostMicros(EMBEDDING_MODEL, 1_000_000, 0)).toBe(
      estimateCostMicros(EMBEDDING_MODEL, 1_000_000, 999_999),
    );
  });
});

describe('the quota counter key (unit)', () => {
  const cycleStart = new Date('2026-08-01T00:00:00.000Z');

  it('is org + cycle start in SECONDS — §1.3 test 9', () => {
    // Seconds and not milliseconds is the single most likely way the TypeScript
    // and Python implementations silently disagree: Python's
    // `datetime.timestamp()` yields seconds, JavaScript's `getTime()` yields
    // milliseconds, and a mismatch means two services counting into two
    // different keys while both believe they are metering the same tenant.
    expect(quotaCounterKey('org-1', cycleStart)).toBe('quota:org-1:1785542400');
  });

  it('gives DIFFERENT cycles different keys', () => {
    // The cycle start is in the key precisely so a billing reset invalidates
    // the counter for free — no cache bust, no migration, no job.
    expect(quotaCounterKey('org-1', cycleStart)).not.toBe(
      quotaCounterKey('org-1', new Date('2026-09-01T00:00:00.000Z')),
    );
  });

  it('gives DIFFERENT tenants different keys', () => {
    expect(quotaCounterKey('org-1', cycleStart)).not.toBe(
      quotaCounterKey('org-2', cycleStart),
    );
  });

  it('truncates a sub-second cycle start rather than rounding', () => {
    // Two services computing the same instant with different precision must
    // still land on one key. Truncation is what both `Math.floor` and Python's
    // `int()` do, so it is the behaviour that ports.
    expect(quotaCounterKey('org-1', new Date('2026-08-01T00:00:00.999Z'))).toBe(
      quotaCounterKey('org-1', cycleStart),
    );
  });

  it('derives the threshold event id FROM the counter key', () => {
    // Derived rather than generated is what makes redelivery harmless under
    // Domain E's `UNIQUE (recipient_id, event_id)` — a uuid would make every
    // retry a new notification.
    expect(quotaThresholdEventId('org-1', cycleStart, 80)).toBe(
      `${quotaCounterKey('org-1', cycleStart)}:80`,
    );
  });

  it('gives each threshold its OWN event id', () => {
    const ids = QUOTA_ALERT_THRESHOLDS.map((threshold) =>
      quotaThresholdEventId('org-1', cycleStart, threshold),
    );

    expect(new Set(ids).size).toBe(QUOTA_ALERT_THRESHOLDS.length);
  });
});

describe('the at-cap policy table (unit)', () => {
  it('covers EVERY surface', () => {
    // `Record<AiSurface, …>` makes this a compile error too, but the runtime
    // check catches an entry present-but-undefined — which would read as
    // "allowed" at the cap.
    for (const surface of Object.values(AiSurface)) {
      expect([surface, AT_CAP_POLICY[surface]]).toEqual([
        surface,
        expect.objectContaining({ action: expect.any(String) }),
      ]);
    }
  });

  it('gives a GRACE to the escalation summary and to nothing else', () => {
    // At the cap two failures compound: deflection stops so ticket volume
    // spikes, and every one of those tickets arrives without a summary because
    // summaries are an AI surface too. The escalation summary is the cheapest
    // call the system makes and has its highest marginal value exactly when the
    // queue is flooded — which is what earns it the exception.
    const withGrace = Object.entries(AT_CAP_POLICY)
      .filter(([, policy]) => policy.graceRatio > 0)
      .map(([surface]) => surface);

    expect(withGrace).toEqual([AiSurface.ESCALATION_SUMMARY]);
  });

  it('BOUNDS that grace at 10%', () => {
    // An unbounded exemption is not a cap.
    expect(AT_CAP_POLICY[AiSurface.ESCALATION_SUMMARY].graceRatio).toBe(0.1);
  });

  it('never REFUSES chat — it escalates instead', () => {
    // "AI disabled" alone would leave a question sitting unanswered, which is
    // worse than a slower answer from a human.
    expect(AT_CAP_POLICY[AiSurface.CHAT_ANSWER].action).toBe(
      AtCapAction.ESCALATE,
    );
  });

  it('DEGRADES knowledge search rather than refusing it', () => {
    // The FTS arm needs no embedding and therefore costs nothing. A flat 402
    // would take away corpus diagnostics at exactly the moment somebody is
    // trying to understand what happened.
    expect(AT_CAP_POLICY[AiSurface.KNOWLEDGE_SEARCH].action).toBe(
      AtCapAction.DEGRADE,
    );
  });

  it('DEFERS ingestion rather than failing it', () => {
    // A tenant who overspent on chat should not also lose document onboarding,
    // and failing the job would discard parsing work already done.
    expect(AT_CAP_POLICY[AiSurface.INGESTION_EMBEDDING].action).toBe(
      AtCapAction.DEFER,
    );
  });

  it('refuses the ASK surface even though search degrades', () => {
    // Retrieval could degrade, but the answer is a generation and there is no
    // free version of it.
    expect(AT_CAP_POLICY[AiSurface.KNOWLEDGE_ASK].action).toBe(
      AtCapAction.REFUSE,
    );
  });
});
