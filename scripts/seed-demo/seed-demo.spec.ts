import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { faker } from '@faker-js/faker';
import { OrgStatus } from '@synapsedesk/common';
import { DEFAULT_SEED, parseArgs } from './args';
import { SEED_EDGES, STEPS } from './registry';
import { PROFILES, bytesFor, countFor, type Profile } from './profiles';
import { planTenant } from './steps/auth.step';
import { ticketCountFor } from './steps/ticket.step';
import { documentPlanFor } from './steps/ingestion.step';
import type { ManifestTenant } from './manifest';
import { REPO_ROOT as REPO } from './paths';

/**
 * The four properties whose absence would matter.
 *
 * A seeder is a script and earns fewer tests than a feature — but two of these
 * guard failures that are invisible until somebody clicks the thing being
 * demonstrated, which is the worst moment to discover them.
 *
 * **No database.** The seeder writes to the DEV databases; a test that seeded
 * one would be writing outside the boundary every suite respects. The steps
 * separate deciding from writing precisely so the decisions can be tested here.
 */
describe('the demo seeder', () => {
  /**
   * The REAL registry, imported rather than mirrored.
   *
   * A copy of the order here asserted nothing about the order there: swapping
   * `ticket` and `ingestion` in `index.ts` left this suite green, which is the
   * failure this test exists to catch.
   */
  const ORDER = STEPS.map((step) => step.service);

  const PLAN = {
    id: 'plan-1',
    name: 'Starter',
    maxAgentSeats: 5,
    maxStorageBytes: 5n * 1024n ** 3n,
    maxDocumentUploads: 1_000,
  };

  /**
   * Strips comments, so a scan reads CODE.
   *
   * The first version of test 6 matched `process.cwd(` inside the docblock that
   * explains why the code no longer calls it — a scan reporting a defect its own
   * fix had documented. Prose that names a symbol is not a use of it.
   */
  const withoutComments = (text: string): string =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  /** `tsconfig.json` carries `//` comments, and `JSON.parse` does not. */
  const stripJsonComments = (text: string): string =>
    text.replace(/^\s*\/\/.*$/gm, '');

  beforeEach(() => faker.seed(1));

  it('1. **The step order satisfies every declared EDGE**', () => {
    // Asserted on the edges rather than on "auth is first", which is the
    // weaker property the first draft asked for: an order of
    // `auth → ingestion → ticket` satisfies "auth first" and violates
    // `ai_generations.ticket_id`, writing AI rows that name tickets which do
    // not exist yet.
    //
    // That edge carries no rows today — seeding the AI ledger is out of scope —
    // so this test is the only thing standing between the deferred work and a
    // silent orphan on the day it lands.
    for (const edge of SEED_EDGES) {
      const from = ORDER.indexOf(edge.from);
      const to = ORDER.indexOf(edge.to);

      expect([edge.via, from]).not.toEqual([edge.via, -1]);
      expect([edge.via, to]).not.toEqual([edge.via, -1]);
      // The referenced service is written FIRST.
      expect({ edge: `${edge.from} → ${edge.to}`, ordered: to < from }).toEqual(
        {
          edge: `${edge.from} → ${edge.to}`,
          ordered: true,
        },
      );
    }

    // Vacuity floor: three edges, and the ingestion → ticket one is present.
    expect(SEED_EDGES.length).toBeGreaterThanOrEqual(3);
    expect(
      SEED_EDGES.some((e) => e.from === 'ingestion' && e.to === 'ticket'),
    ).toBe(true);
  });

  it('2. **A seeded tenant is under every plan limit**', () => {
    // The one whose failure produces a demo that works right up until somebody
    // clicks the thing being demonstrated. A direct database write bypasses
    // every enforcement point, so a fixed count would put a tenant over a limit
    // the product does have — demonstrating broken behaviour that does not
    // exist.
    for (const profileName of Object.keys(
      PROFILES,
    ) as (keyof typeof PROFILES)[]) {
      const profile = PROFILES[profileName];

      for (let index = 0; index < profile.tenants; index++) {
        const shape = planTenant(PLAN, profile, index, index === 0);

        expect({
          profileName,
          seats: shape.users <= PLAN.maxAgentSeats,
          documents: shape.documents <= PLAN.maxDocumentUploads,
          bytes: shape.storageBytes <= PLAN.maxStorageBytes,
        }).toEqual({
          profileName,
          seats: true,
          documents: true,
          bytes: true,
        });

        // And not vacuously zero — a tenant with nothing in it demos nothing.
        expect(shape.users).toBeGreaterThan(0);
      }
    }
  });

  it('2b. …and a fill above 1 still cannot produce one', () => {
    // The clamp, exercised directly. `countFor` is three lines and removes the
    // whole class, so it is worth proving it removes it rather than assuming.
    expect(countFor(10, 5)).toBe(10);
    expect(countFor(10, -1)).toBe(0);
    expect(countFor(0, 0.5)).toBe(0);
    expect(bytesFor(100n, 5)).toBe(100n);
    expect(bytesFor(100n, -1)).toBe(0n);
    // The ceiling only ever lowers.
    expect(countFor(1_000, 0.9, 50)).toBe(50);
    expect(countFor(10, 0.9, 50)).toBe(9);
  });

  it('3. **The same seed produces the same plan**', () => {
    // A demo you can screenshot twice, row counts a smoke test can assert, and
    // a bug report that says "tenant 3" meaning the same rows elsewhere.
    const run = () => {
      faker.seed(42);

      return Array.from({ length: PROFILES.demo.tenants }, (_, index) =>
        planTenant(PLAN, PROFILES.demo, index, index === 0),
      );
    };

    expect(run()).toEqual(run());

    // Not vacuous: a DIFFERENT seed moves the numbers. Compared on the fields
    // faker decides — `status` and `deleted` are positional by design.
    faker.seed(7);
    const other = Array.from({ length: PROFILES.demo.tenants }, (_, index) =>
      planTenant(PLAN, PROFILES.demo, index, index === 0),
    );
    expect(other.map((t) => t.users)).not.toEqual(run().map((t) => t.users));
  });

  it('4. **Every id a later step writes comes from the manifest**', () => {
    // The cross-database integrity the databases themselves cannot express —
    // there is no foreign key between them, so a step that invented an
    // `organizationId` would write rows unreachable through the API and
    // invisible to every constraint, discoverable only when a page rendered a
    // blank author.
    const tenant: ManifestTenant = {
      organizationId: 'org-1',
      name: 'Acme',
      slug: 'acme',
      planName: 'Starter',
      grants: {
        maxAgentSeats: 5,
        maxStorageBytes: (5n * 1024n ** 3n).toString(),
        maxDocumentUploads: 1_000,
      },
      planned: { documents: 10, storageBytes: (1024n * 1024n).toString() },
      departmentIds: ['dept-1'],
      userIds: ['user-1', 'user-2'],
      adminUserId: 'user-1',
    };

    // The ticket step's count is a function of the manifest's user list, so it
    // cannot describe tickets for users auth never created.
    const tickets = ticketCountFor(tenant, PROFILES.demo);
    expect(tickets).toBeGreaterThanOrEqual(
      tenant.userIds.length * PROFILES.demo.ticketsPerUser[0],
    );
    expect(tickets).toBeLessThanOrEqual(
      tenant.userIds.length * PROFILES.demo.ticketsPerUser[1],
    );

    // The ingestion step SPENDS what auth planned rather than deriving a second
    // answer — two definitions of "how many documents" would drift the moment
    // either fill changed.
    const documents = documentPlanFor(tenant);
    expect(documents.documents).toBe(tenant.planned.documents);
    expect(
      documents.bytesEach * BigInt(documents.documents),
    ).toBeLessThanOrEqual(BigInt(tenant.planned.storageBytes));
  });

  it('5. **The seeder is in the program `npm run typecheck` compiles**', () => {
    // `tsx` runs without typechecking, so a wrong enum member is `undefined` at
    // runtime — measured: `DocumentStatus.COMPLETED` does not exist, Prisma
    // applied the column default, and 200 documents landed `PENDING` while the
    // run reported success. The repository's own typecheck is what catches
    // that, and it only does so if these files are in its include list.
    //
    // **A scan IS the guard here, not a substitute for one.** "The typechecker
    // reads this file" has no runtime expression — nothing observable at
    // execution distinguishes an included file from an excluded one — so there
    // is no behavioural test this stands in for.
    const config = readFileSync(join(REPO, 'tsconfig.json'), 'utf8');
    const include = (
      JSON.parse(stripJsonComments(config)) as {
        include: string[];
      }
    ).include;

    expect(include).toContain('scripts/seed-demo/**/*');

    // Vacuity floor: a rewritten config with one entry must not pass, and the
    // entries the rest of the repo depends on are still there.
    expect(include).toContain('libs/*/src/**/*');
    expect(include).toContain('apps/*/src/**/*');
    expect(include.length).toBeGreaterThanOrEqual(4);

    // And no second command claiming to do the same job — one named "typecheck
    // the scripts" would assert that the root typecheck does not.
    const pkg = JSON.parse(
      readFileSync(join(REPO, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    expect(Object.keys(pkg.scripts)).not.toContain('typecheck:scripts');
  });

  it('6. **Nothing in the tool anchors to the working directory**', () => {
    // The tool had two opinions about where it was: databases relative to the
    // source file, manifest relative to `process.cwd()`. Run from `scripts/` it
    // connected to the right three databases and reported "No manifest … run
    // the auth step first" — a true sentence about the wrong file.
    //
    // **A source scan, because the difference has no expression inside this
    // process.** `MANIFEST_PATH` is computed at import, and jest cannot start
    // itself in another directory — an earlier version of this test overrode
    // `process.cwd` afterwards and passed against the defect it was written
    // for. Reproducing it needs a child process started elsewhere; asserting
    // the anchor is the guard that fits in a unit test, and it is exact.
    const sources = ['manifest.ts', 'clients.ts', 'index.ts'].map((file) => ({
      file,
      text: withoutComments(
        readFileSync(join(REPO, 'scripts/seed-demo', file), 'utf8'),
      ),
    }));

    for (const { file, text } of sources) {
      // Vacuity floor: the file resolved and is the one we mean.
      expect([file, text.length > 200]).toEqual([file, true]);
      expect([file, text.includes('process.cwd(')]).toEqual([file, false]);
    }

    // And the anchor they use instead is the file-relative one.
    const paths = readFileSync(
      join(REPO, 'scripts/seed-demo/paths.ts'),
      'utf8',
    );
    expect(paths).toContain('__dirname');
    // The pattern fires: `process.cwd(` is a string these files COULD contain,
    // and the check above is not passing because the needle never matches.
    expect(`const p = process.cwd();`).toContain('process.cwd(');
  });

  it('7. **A plan granting zero seats produces no tenant, not a tenant with one user**', () => {
    // The single call whose result could exceed the grant, when the grant is
    // zero. `MIN_AGENT_SEATS = 1` makes it unreachable through the API — and
    // that is a `@Min()` on a gateway request DTO, which this tool never
    // crosses: it reads `subscription_plans` directly.
    const zeroSeats = { ...PLAN, maxAgentSeats: 0 };

    expect(planTenant(zeroSeats, PROFILES.demo, 0, false).users).toBe(0);

    // Not vacuous, and the other end of the same fix: a plan granting ONE seat
    // gets exactly one user. Flooring alone produced zero there — `1 * 0.5`
    // rounds down — so the smallest plan would never have appeared in the demo.
    expect(
      planTenant({ ...PLAN, maxAgentSeats: 1 }, PROFILES.demo, 0, false).users,
    ).toBe(1);

    // And the floor never beats the clamp: at every profile, a one-seat plan
    // holds one user and no more.
    for (const profile of Object.values(PROFILES)) {
      expect(
        planTenant({ ...PLAN, maxAgentSeats: 1 }, profile, 0, false).users,
      ).toBe(1);
    }
  });

  it('8. **`PROFILES` satisfies `Profile` with the readonly tuples `as const` produces**', () => {
    // A FORWARD guard: it cannot go red under this workspace's TypeScript
    // (6.0.3 accepts the mutable declaration too), and it is not
    // sabotage-verifiable for that reason. Its value is that the declaration
    // stops disagreeing with the values — five FIXMEs recorded a compiler that
    // did object.
    const profile: Profile = PROFILES.demo;

    expect(profile.seatFill).toHaveLength(2);
    expect(profile.seatFill[0]).toBeLessThan(profile.seatFill[1]);
  });

  it('9. **A non-numeric `--seed` is refused, not coerced**', () => {
    // `Number('abc')` is `NaN`, `faker.seed(NaN)` does not throw, and the run is
    // silently non-deterministic — losing the one property the flag exists to
    // control, in the one mode where nobody would notice.
    expect(() => parseArgs(['--seed=abc'])).toThrow(/--seed must be a number/);
    expect(() => parseArgs(['--seed='])).toThrow(/--seed must be a number/);

    // Not vacuous: a numeric seed parses, and the default applies with none.
    expect(parseArgs(['--seed=42']).seed).toBe(42);
    expect(parseArgs([]).seed).toBe(DEFAULT_SEED);
  });

  it('9b. …and an unknown profile or step is refused by name', () => {
    expect(() => parseArgs(['--profile=huge'])).toThrow(/Unknown profile/);
    expect(() => parseArgs(['--only=notification'])).toThrow(/Unknown step/);

    // `notification` is refused specifically because that step does not exist:
    // Domain E rows are produced by consuming commands, and hand-writing them
    // means minting the `event_id`s that decide whether somebody was told.
    expect(parseArgs(['--only=ticket']).only).toBe('ticket');
  });

  it('The lifecycle spread includes a suspended and an offboarded tenant', () => {
    // A dashboard filter that excludes nothing is untested by a demo where
    // every tenant is ACTIVE.
    const tenants = Array.from({ length: PROFILES.demo.tenants }, (_, index) =>
      planTenant(PLAN, PROFILES.demo, index, index === 0),
    );

    expect(tenants.map((t) => t.status)).toContain(
      OrgStatus.SUSPENDED_PAST_DUE,
    );
    expect(tenants.some((t) => t.deleted)).toBe(true);
    expect(tenants.some((t) => t.entitlementsPinned)).toBe(true);
  });
});
