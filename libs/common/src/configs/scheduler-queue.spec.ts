import { SCHEDULED_JOBS, SCHEDULER_QUEUE } from './scheduler.config';

/**
 * The queue names are per service — the cheap guard from the shared-queue bug.
 *
 * **What flattening this back costs**, so the number below is not mistaken for
 * tidiness: with one shared name, every service runs a worker on everyone's
 * queue, BullMQ gives each job to whichever worker claims it first, and a worker
 * cannot decline a name it does not know. The job is claimed, discarded, marked
 * SUCCESSFUL, and its schedule advances. Roughly two thirds of every service's
 * scheduled runs disappeared, with nothing failing anywhere.
 *
 * A unit test cannot reproduce that — it needs two services and a real Redis,
 * which is `scheduler-ownership.e2e-spec.ts`. This is the one that runs on every
 * commit and fails the moment somebody collapses the constant.
 */
describe('SCHEDULER_QUEUE', () => {
  // Widened to `string[]` deliberately. Left as the literal union, collapsing
  // the three values to one narrows it to a single literal and the checks below
  // fail to COMPILE — which is red, but names a type error instead of the rule
  // that was broken. A guard should say what went wrong.
  const names: string[] = Object.values(SCHEDULER_QUEUE);

  it('**is one queue per service, never a shared string**', () => {
    expect(typeof SCHEDULER_QUEUE).toBe('object');
    expect(SCHEDULER_QUEUE).toEqual({
      auth: 'scheduler-auth',
      ticket: 'scheduler-ticket',
      ingestion: 'scheduler-ingestion',
    });
  });

  it('**and every name is distinct**', () => {
    // The property that matters, stated independently of the literals above so
    // a rename that accidentally duplicates one still fails here.
    expect(new Set(names).size).toBe(names.length);
  });

  it('covers every service that schedules work', () => {
    // Guards against a fourth service registering repeatables and reaching for
    // whichever name is nearest. Every job in `SCHEDULED_JOBS` belongs to one
    // of these three, so the two lists have to grow together.
    expect(Object.keys(SCHEDULER_QUEUE).sort()).toEqual([
      'auth',
      'ingestion',
      'ticket',
    ]);
    expect(Object.keys(SCHEDULED_JOBS).length).toBeGreaterThanOrEqual(3);
  });

  it('**and no name contains a colon** — BullMQ rejects one outright', () => {
    // `new Queue('scheduler:auth')` throws `Queue name cannot contain :`, so
    // this is a boot failure rather than a subtle one. Pinned because the
    // obvious way to namespace a queue is exactly the way that does not work,
    // and because the hyphen is also what keeps `DEL bull:scheduler:*` from
    // deleting these when the old shared queue is swept.
    for (const name of names) expect(name).not.toContain(':');
  });

  it('and no name collides with another as a Redis key PREFIX', () => {
    // BullMQ keys are `bull:{name}:…`, so a name that is a prefix of another
    // makes one queue's keyspace a subset of the other's — which is invisible
    // in normal operation and destroys the wrong queue the first time somebody
    // sweeps one with a glob.
    for (const name of names) {
      const others = names.filter((other) => other !== name);

      expect(others.filter((other) => other.startsWith(`${name}:`))).toEqual(
        [],
      );
    }
  });
});
