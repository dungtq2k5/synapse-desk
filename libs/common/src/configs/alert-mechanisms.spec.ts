import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LIMIT_ALERT_DIMENSIONS,
  limitThresholdEventId,
} from './limit-alerts.config';
import { quotaThresholdEventId } from './ai-pricing.config';

/**
 * Two alert mechanisms, and the properties that keep them apart.
 *
 * A metered dimension re-arms because its cycle start is in the id; a level
 * dimension re-arms because a generation is. Migrating either onto the other
 * breaks it silently — the budget would stop re-arming at the cycle roll, and
 * the levels would nag or never fire again.
 */
describe('The two alert mechanisms', () => {
  const REPO = join(__dirname, '../../../..');

  it('3. **The AI budget still deduplicates by CYCLE, untouched**', () => {
    // Behaviour, not a source check: the budget's id must change when the
    // cycle rolls and must not otherwise. Routing it through the level alarm
    // would give it a generation that only moves on recovery — and a budget
    // never "recovers", it resets.
    const january = new Date('2026-01-01T00:00:00.000Z');
    const february = new Date('2026-02-01T00:00:00.000Z');

    expect(quotaThresholdEventId('org-1', january, 80)).toBe(
      quotaThresholdEventId('org-1', january, 80),
    );
    expect(quotaThresholdEventId('org-1', january, 80)).not.toBe(
      quotaThresholdEventId('org-1', february, 80),
    );
    // And it carries no generation — the two id shapes are distinguishable on
    // sight, which is what stops a reader assuming one mechanism.
    expect(quotaThresholdEventId('org-1', january, 80)).not.toContain('limit:');
  });

  it('**…and the two id shapes never collide**', () => {
    // They land in one column, `notifications.event_id`, under one unique
    // index. A shared shape would let a budget alert suppress a storage alert.
    const ids = new Set([
      quotaThresholdEventId('org-1', new Date('2026-01-01T00:00:00.000Z'), 80),
      limitThresholdEventId('org-1', 'storage', 80, 0),
      limitThresholdEventId('org-1', 'seats', 80, 0),
    ]);

    expect(ids.size).toBe(3);
  });

  it('6. **Every dimension derives its id through ONE function**', () => {
    // The durable guard is a PARTIAL index — `WHERE event_id IS NOT NULL` — so
    // a producer that generated an id would not fail to match it, it would fall
    // outside it and get no dedupe at all, looking identical to one that did.
    // No runtime test can see that, because a generated id publishes perfectly
    // well; only reading the producers can.
    const publisher = readFileSync(
      join(REPO, 'libs/common/src/utils/limit-alert-publisher.ts'),
      'utf8',
    );

    // The vacuity guard: a path that stopped resolving would make every check
    // below pass over nothing.
    expect(publisher).toContain('class LimitAlertPublisher');

    expect(publisher).toContain('limitThresholdEventId(');
    // And nothing in the alert path mints one.
    expect(publisher).not.toMatch(/randomUUID|crypto\.randomUUID|Math\.random/);
    // The message id and the durable id are the SAME string, so the stream's
    // window and the constraint collapse on one field rather than two.
    expect(publisher).toMatch(
      /publish\(\s*IN_APP_NOTIFICATION_PATTERN,\s*command,\s*eventId,?\s*\)/,
    );
  });

  it('6b. **…and every dimension goes through that publisher**', () => {
    // One producer per dimension, none of them hand-rolling a command. A
    // second copy of the publish logic is a second chance to generate an id.
    const producers = [
      'apps/ingestion-service/src/modules/documents/documents.service.ts',
      'apps/auth-service/src/modules/organizations/organizations.service.ts',
    ].map((path) => readFileSync(join(REPO, path), 'utf8'));

    for (const source of producers) {
      expect(source).toContain('limitAlerts.evaluate(');
      // Not building the command itself — that is the publisher's job.
      expect(source).not.toContain('IN_APP_NOTIFICATION_PATTERN');
    }

    // Every dimension in the vocabulary is produced by somebody. A dimension
    // added to the list and to no producer alerts on nothing, silently.
    //
    // **Keyed on the CALL, not on the bare literal.** The first version
    // asserted `all.toContain("'storage'")`, which is satisfied by the word
    // appearing anywhere across the joined corpus — including in a comment left
    // behind by a deleted call. Each dimension has to appear as an argument of
    // an `evaluate(`.
    const all = producers.join('\n');
    for (const dimension of LIMIT_ALERT_DIMENSIONS) {
      expect(all).toMatch(
        new RegExp(`limitAlerts\\.evaluate\\(\\s*[^)]*'${dimension}'`),
      );
    }

    // The pattern fires: a dimension that is NOT produced anywhere must fail
    // the same check. Without this the loop above is only as strong as its
    // regex, and a regex that matches nothing passes vacuously for a list it
    // never enters.
    expect(all).not.toMatch(
      new RegExp(`limitAlerts\\.evaluate\\(\\s*[^)]*'analytics'`),
    );
  });

  it('7. **Every site that REFUSES on seats also ALERTS on them**', () => {
    // Omission, not rename — which is what makes this a scan. A new seat
    // refusal that forgets the alarm is invisible at runtime: the tenant is
    // still refused, so every behavioural test passes, and the only symptom is
    // a warning that never arrives.
    //
    // **Keyed on the COMPARISON, not on the identifier.** Grepping for
    // `seatsInUse` also flags `platform.service.ts`'s metrics rollup, which
    // counts seats for a response field and correctly alerts on nothing. What
    // makes a site a refusal is comparing that count against `maxAgentSeats`.
    const REFUSAL =
      /seatsInUse\([^)]*\)[\s\S]{0,80}?>=?[\s\S]{0,40}?maxAgentSeats/;

    const candidates = [
      'apps/auth-service/src/modules/invitations/invitations.service.ts',
      'apps/auth-service/src/modules/users/users.service.ts',
      'apps/auth-service/src/modules/platform/platform.service.ts',
      'apps/auth-service/src/modules/organizations/organizations.service.ts',
    ].map((path) => ({
      path,
      source: readFileSync(join(REPO, path), 'utf8'),
    }));

    const refusals = candidates.filter(({ source }) => REFUSAL.test(source));

    // Corpus floor: two known refusal sites today. Zero would make the loop
    // below pass over nothing, which is how a scan stops scanning.
    expect(refusals.map(({ path }) => path)).toEqual([
      'apps/auth-service/src/modules/invitations/invitations.service.ts',
      'apps/auth-service/src/modules/users/users.service.ts',
    ]);

    for (const { path, source } of refusals) {
      expect([path, /alertOnSeats\(/.test(source)]).toEqual([path, true]);
    }

    // The pattern fires: the metrics rollup counts seats and is NOT a refusal,
    // so it must stay out of the set above. Without this the regex could match
    // everything and the assertion would still read as a pass.
    const metrics = candidates.find(({ path }) =>
      path.endsWith('platform/platform.service.ts'),
    );
    expect(metrics?.source).toContain('seatsInUse');
    expect(REFUSAL.test(metrics?.source ?? '')).toBe(false);
  });
});
