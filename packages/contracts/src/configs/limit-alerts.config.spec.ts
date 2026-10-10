import {
  INITIAL_LIMIT_ALERT_STATE,
  LIMIT_ALERT_HYSTERESIS_BAND,
  LIMIT_ALERT_THRESHOLDS,
  evaluateLimitAlert,
  limitAlertStateKeys,
  limitAlertStateKey,
  LIMIT_ALERT_DIMENSIONS,
  limitThresholdEventId,
} from './limit-alerts.config';
import { PLAN_LIMIT_DIMENSIONS } from './billing.config';

/**
 * The hysteresis rule, which is the whole of this phase's real decision.
 *
 * Tests 1 and 2 are a PAIR and neither alone is enough: test 1 passes for a
 * permanent key and test 2 passes for a TTL key. Only both together describe a
 * level alarm.
 */
describe('The level alarm', () => {
  it('1. **Crossing 80% alerts once; parked at 81% it stays quiet**', () => {
    const crossing = evaluateLimitAlert(80, INITIAL_LIMIT_ALERT_STATE);

    expect(crossing.alerts).toEqual([80]);
    expect(crossing.state.level).toBe(80);

    // The reading that a TTL key would nag on, over and over.
    const parked = evaluateLimitAlert(81, crossing.state);

    expect(parked.alerts).toEqual([]);
    expect(parked.state).toEqual(crossing.state);
  });

  it('2. **Falling to 70% and climbing back to 85% alerts AGAIN**', () => {
    // The reading a permanent key would swallow — and the reason the state
    // carries a generation rather than only a level.
    const raised = evaluateLimitAlert(85, INITIAL_LIMIT_ALERT_STATE);
    expect(raised.alerts).toEqual([80]);

    const fallen = evaluateLimitAlert(70, raised.state);
    expect(fallen.alerts).toEqual([]);
    expect(fallen.state.generation).toBe(1);

    const again = evaluateLimitAlert(85, fallen.state);
    expect(again.alerts).toEqual([80]);

    // **And the event id DIFFERS**, which is what makes the second alert
    // deliverable: Domain E's `UNIQUE (recipient_id, event_id)` is permanent —
    // nothing sweeps that table — so re-publishing the first id would be
    // rejected as a duplicate having never reached anybody.
    expect(
      limitThresholdEventId('org-1', 'storage', 80, raised.state.generation),
    ).not.toBe(
      limitThresholdEventId('org-1', 'storage', 80, again.state.generation),
    );
  });

  it('2b. A fall INSIDE the band does not re-arm', () => {
    // Hovering on the boundary is the noise the band exists for: 80 → 79 → 80
    // must not produce two alerts.
    const raised = evaluateLimitAlert(80, INITIAL_LIMIT_ALERT_STATE);
    const dipped = evaluateLimitAlert(
      80 - LIMIT_ALERT_HYSTERESIS_BAND + 1,
      raised.state,
    );

    expect(dipped.alerts).toEqual([]);
    expect(dipped.state.generation).toBe(0);
    expect(evaluateLimitAlert(80, dipped.state).alerts).toEqual([]);
  });

  it('3. Climbing past several thresholds at once alerts for each', () => {
    // A tenant who uploads one large file can go from 40% to 100%. Reporting
    // only the highest would lose "you passed 80" from the record, and
    // reporting only the lowest would bury the one that matters.
    const jumped = evaluateLimitAlert(100, INITIAL_LIMIT_ALERT_STATE);

    expect(jumped.alerts).toEqual([...LIMIT_ALERT_THRESHOLDS]);
    expect(jumped.state.level).toBe(100);
  });

  it('4. A full recovery is ONE re-arm, not one per threshold cleared', () => {
    // Falling from 100% to 5% is a single recovery. Counting three would make
    // the generation a step counter rather than a re-arm counter, and the ids
    // would skip values for no reason anybody could explain later.
    const full = evaluateLimitAlert(100, INITIAL_LIMIT_ALERT_STATE);
    const recovered = evaluateLimitAlert(5, full.state);

    expect(recovered.state.generation).toBe(1);
    expect(recovered.state.level).toBe(0);
    expect(evaluateLimitAlert(80, recovered.state).alerts).toEqual([80]);
  });

  it('5. **Every dimension derives its id the same way**', () => {
    // The durable guard has nothing to match on unless the id is derived, and
    // a dimension that generated one would look identical while landing
    // outside the constraint entirely.
    expect(limitThresholdEventId('org-1', 'seats', 95, 0)).toBe(
      'limit:org-1:seats:95:0',
    );
    // Distinct per dimension, per threshold, per generation, per tenant.
    const ids = new Set([
      limitThresholdEventId('org-1', 'seats', 95, 0),
      limitThresholdEventId('org-1', 'storage', 95, 0),
      limitThresholdEventId('org-1', 'seats', 80, 0),
      limitThresholdEventId('org-1', 'seats', 95, 1),
      limitThresholdEventId('org-2', 'seats', 95, 0),
    ]);
    expect(ids.size).toBe(5);
  });

  it('**The generation must outlive the level** — the lifetime rule, stated', () => {
    // The rule underneath the storage split: a counter that steps past a
    // PERMANENT guard cannot be shorter-lived than the guard.
    //
    // Simulated here rather than described: a Redis flush resets the level AND,
    // if the generation lived beside it, the generation too. Replaying the same
    // crossing then reproduces an id Domain E already holds — and that alert is
    // never delivered again, from a transient failure, with nothing reporting
    // it. Reading the generation from the durable store instead keeps the id
    // moving.
    const raised = evaluateLimitAlert(85, INITIAL_LIMIT_ALERT_STATE);
    const recovered = evaluateLimitAlert(60, raised.state);

    // What a flush would leave behind if BOTH halves were cached.
    const afterFlushIfCached = evaluateLimitAlert(
      85,
      INITIAL_LIMIT_ALERT_STATE,
    );
    expect(
      limitThresholdEventId(
        'org-1',
        'storage',
        80,
        afterFlushIfCached.state.generation,
      ),
    ).toBe(
      limitThresholdEventId('org-1', 'storage', 80, raised.state.generation),
    );

    // What actually happens: the level is lost, the generation is not.
    const afterFlush = evaluateLimitAlert(85, {
      level: INITIAL_LIMIT_ALERT_STATE.level,
      generation: recovered.state.generation,
    });
    expect(
      limitThresholdEventId(
        'org-1',
        'storage',
        80,
        afterFlush.state.generation,
      ),
    ).not.toBe(
      limitThresholdEventId('org-1', 'storage', 80, raised.state.generation),
    );

    // And losing the level alone costs at most a repeat that the durable guard
    // collapses — which is why it is the half that may be cached.
    expect(afterFlush.alerts).toEqual([80]);
  });

  it('6. Offboarding has a key for every dimension', () => {
    // The state has no TTL by design, so nothing reclaims it unless something
    // does. A dimension added without a key here leaks one row per tenant,
    // forever, and nothing would ever say so.
    //
    // Quantified over the dimension list rather than pinned to three literals:
    // the first version listed the keys, which made ADDING a dimension — a
    // correct change — turn this red, and the fix was to edit the expectation.
    // A test whose repair is "update the answer" guards the answer, not the
    // property. What is asserted is the property: one key per dimension, each
    // built by the same function the alarm writes with.
    expect(limitAlertStateKeys('org-1')).toEqual(
      LIMIT_ALERT_DIMENSIONS.map((dimension) =>
        limitAlertStateKey('org-1', dimension),
      ),
    );
    expect(limitAlertStateKeys('org-1')).toHaveLength(
      LIMIT_ALERT_DIMENSIONS.length,
    );

    // Vacuity floor — an empty dimension list satisfies the two above.
    expect(LIMIT_ALERT_DIMENSIONS.length).toBeGreaterThanOrEqual(3);
  });

  it('7. The alert dimensions and the plan-limit dimensions agree today', () => {
    // They are separate constants for separate questions, and both docblocks
    // say so — this is not a demand that they stay equal. It is a tripwire: a
    // dimension added to one and not the other becomes a deliberate edit here,
    // where the reason the two are allowed to diverge is written down, rather
    // than a difference nobody notices.
    expect([...LIMIT_ALERT_DIMENSIONS].sort()).toEqual(
      [...PLAN_LIMIT_DIMENSIONS].sort(),
    );
  });
});
