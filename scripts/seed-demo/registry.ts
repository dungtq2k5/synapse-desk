/**
 * @file The ordered steps, and the edges that order them.
 *
 * There is no transaction across three databases and there must not be a
 * two-phase commit for a demo seeder. What makes that safe is the DIRECTION of
 * the references: every cross-database id points backwards along this array, so
 * a failure at any step leaves every earlier step committed and internally
 * consistent. A partial run is a smaller demo, not an invalid one.
 */

import type { SeedClients } from './clients';
import { authStep } from './steps/auth.step';
import { ticketStep } from './steps/ticket.step';
import { ingestionStep } from './steps/ingestion.step';
import type { Manifest } from './manifest';
import type { Profile } from './profiles';

export type SeedService = 'auth' | 'ticket' | 'ingestion';

export type StepContext = {
  /** Filled by the auth step, consumed by every later one. */
  manifest: Manifest;
  profile: Profile;
  /** Applies the writes. `false` on a dry run — steps still build their plan. */
  apply: boolean;
  /** The three clients, one per service, opened once for the run. */
  clients: SeedClients;
};

export type SeedStep = {
  service: SeedService;
  /**
   * Writes this service's rows and returns one line per tenant for the log.
   *
   * Reads and mutates `context.manifest`: the auth step FILLS it, and every
   * later step draws its ids from it. That is the whole handoff — a step that
   * generated an id instead would write rows unreachable through the API and
   * invisible to every constraint.
   */
  run(context: StepContext): Promise<string[]>;
};

/**
 * Which service's rows reference which other service's.
 *
 * **A DAG, not a star.** The first draft of this design said every edge points
 * at `auth`; `ai_generations.ticket_id` is the counterexample, and it is the
 * reason the order test asserts EDGES rather than "auth is first" — that
 * weaker property is satisfied by an order that puts ingestion before ticket,
 * which would write AI rows naming tickets that do not exist yet.
 *
 * The ingestion → ticket edge carries no rows today, because seeding the AI
 * ledger is deliberately out of scope. It becomes load-bearing the day that
 * lands, which is exactly the day nobody re-reads this file.
 */
export const SEED_EDGES: ReadonlyArray<{
  from: SeedService;
  to: SeedService;
  via: string;
}> = [
  {
    from: 'ticket',
    to: 'auth',
    via: 'organization_id, created_by_id, department_id',
  },
  { from: 'ingestion', to: 'auth', via: 'organization_id, uploaded_by_id' },
  { from: 'ingestion', to: 'ticket', via: 'ai_generations.ticket_id' },
];

/**
 * Every tenant a step writes for, drawn from the manifest and nowhere else.
 *
 * A helper rather than a convention: a step that filtered or generated its own
 * tenant list is how an orphan gets written, and a named function is something
 * a reviewer can grep for.
 */
export function tenantsOf(context: StepContext): Manifest['tenants'] {
  return context.manifest.tenants;
}

/**
 * The registry itself — the ordered array the orchestrator iterates.
 *
 * **Here rather than in `index.ts`, and the test is why.** While this lived
 * beside `main()` the order test had to mirror it, so the assertion guarded a
 * copy: swapping `ticket` and `ingestion` in the real array left every test
 * green. A spec cannot import `index.ts` — that module runs the seeder on
 * import — so the array moved to the file named after it, which is also where a
 * reader looks for it.
 *
 * Adding a domain is one step file and one entry here.
 */
export const STEPS: readonly SeedStep[] = [authStep, ticketStep, ingestionStep];
