/**
 * @file Tenants, users, departments and billing history.
 *
 * First in the order because everything else references it and it references
 * nothing: `postgres_auth` names no ticket, document or notification id.
 */

import { faker } from '@faker-js/faker';
import {
  BillingEventStatus,
  OrgStatus,
  SystemRoleName,
} from '@synapsedesk/common';
import {
  createDepartment,
  createOrganization,
  createUser,
  findSystemRole,
  hashTestPassword,
} from '../../../apps/auth-service/test/factories';
import type { PrismaService } from '../../../apps/auth-service/src/modules/prisma/prisma.service';
import type { ManifestTenant } from '../manifest';
import type { SeedStep } from '../registry';
import { bytesFor, countFor, type Profile } from '../profiles';

/** The one password every demo user shares, hashed once — see `seedAuth`. */
export const DEMO_PASSWORD = 'DemoPassw0rd!';

/** Ceilings copied from `DatabaseSeeder`, which solved this first. */
const TRANSACTION_TIMEOUT_MS = 30_000;

/**
 * **The one the first draft missed.** Prisma's default is 2 seconds to ACQUIRE
 * a connection, and a loop of per-tenant transactions against a pool this run
 * is itself using is precisely the arrangement that exceeds it. The failure is
 * `P2024`, which reads as a database problem rather than as a setting.
 */
const TRANSACTION_MAX_WAIT_MS = 15_000;

/**
 * The lifecycle spread, so the platform list has something to filter.
 *
 * One `SUSPENDED_PAST_DUE` and one offboarded, deliberately — the second is
 * what proves a dashboard's filters exclude what they should, which an
 * all-ACTIVE demo cannot show.
 */
const LIFECYCLE: readonly OrgStatus[] = [
  OrgStatus.ACTIVE,
  OrgStatus.ACTIVE,
  OrgStatus.SUSPENDED_PAST_DUE,
  OrgStatus.ACTIVE,
  OrgStatus.FROZEN,
];

type PlanRow = {
  id: string;
  name: string;
  maxAgentSeats: number;
  maxStorageBytes: bigint;
  maxDocumentUploads: number;
};

/** What one tenant will hold, decided before anything is written. */
export type TenantPlan = {
  planName: string;
  status: OrgStatus;
  users: number;
  documents: number;
  storageBytes: bigint;
  deleted: boolean;
  entitlementsPinned: boolean;
};

/**
 * Every quantity as a fraction of the tenant's own GRANT.
 *
 * **The rule §5 exists for.** A fixed `[10, 50]` documents is inside a Pro
 * plan's 10,000 and outside a plan granting five, and the tenant that is over
 * demonstrates a limit the product does not have — a demo that is worse than
 * no demo. `countFor` clamps to the grant, so even a fill above 1 cannot
 * produce one.
 *
 * `nearThreshold` is the deliberate exception: ONE tenant is seeded just past
 * 80% so the level alarm has something to show. Deliberate rather than an
 * accident of random sizes, which is the difference between a demo and a
 * surprise.
 */
export function planTenant(
  plan: PlanRow,
  profile: Profile,
  index: number,
  nearThreshold: boolean,
): TenantPlan {
  const fill = (range: readonly [number, number]) =>
    nearThreshold
      ? profile.nearThresholdFill
      : faker.number.float({ min: range[0], max: range[1] });

  return {
    planName: plan.name,
    status: LIFECYCLE[index % LIFECYCLE.length],
    // **A floor BOUNDED BY THE GRANT, which is the part the first version got
    // wrong in both directions.**
    //
    // `Math.max(1, …)` alone could exceed a grant of zero — the single call
    // whose result could break the clamp `countFor` exists to provide. Dropping
    // it entirely then broke the other end: a plan granting one seat with a
    // 0.3–0.8 fill floors to zero users, so the smallest plan never appears in
    // the demo at all. Neither is what §5 asks for.
    //
    // `min(grant, max(1, …))` is: a positive grant always gets an admin, and
    // never more than it grants. A grant of ZERO gets no tenant — `seedAuth`
    // skips it — which is truthful, where a zero-grant tenant holding one user
    // would demonstrate a limit that does not hold.
    //
    // That case is unreachable through the API, and that is a weaker guarantee
    // than it reads: `MIN_AGENT_SEATS = 1` is a `@Min()` on a GATEWAY REQUEST
    // DTO, and this tool reads `subscription_plans` directly and never crosses
    // it. The same DTO sets `MIN_STORAGE_BYTES = 0`, so a zero grant is already
    // reachable on another dimension.
    users: seatsFor(plan.maxAgentSeats, fill(profile.seatFill), profile),
    documents: countFor(
      plan.maxDocumentUploads,
      fill(profile.documentFill),
      profile.rowCeiling,
    ),
    storageBytes: bytesFor(plan.maxStorageBytes, fill(profile.storageFill)),
    // The last tenant is offboarded, so the platform list has one row its
    // filters must exclude.
    deleted: index > 0 && index === profile.tenants - 1,
    // One off-catalogue tenant, which every plan-apply projection has to skip.
    entitlementsPinned: index === 1,
  };
}

/**
 * Users for one tenant: at least one when the plan grants any, never more than
 * it grants, and none at all when it grants none.
 *
 * Separated from the expression so the invariant has a name and a test —
 * `min(grant, max(1, …))` read inline is the kind of thing a later edit
 * simplifies to one half of itself.
 */
function seatsFor(grant: number, fill: number, profile: Profile): number {
  if (grant <= 0) return 0;

  return Math.min(
    grant,
    Math.max(1, countFor(grant, fill, profile.rowCeiling)),
  );
}

/**
 * Writes the tenants and returns the manifest rows the later steps consume.
 *
 * **One transaction per tenant, not one for the run.** A tenant is the natural
 * unit: it is what a partial run leaves behind and what `--only` reruns, and
 * `large` would exceed any single-transaction budget.
 */
export const authStep: SeedStep = {
  service: 'auth',
  async run(context) {
    const { tenants, lines } = await seedAuth(
      context.clients.auth,
      context.profile,
      context.apply,
    );

    // **The step FILLS the manifest** — held even on a dry run, because the two
    // steps below read it to print their own plan, and a dry run that showed a
    // third of the run would read as though the rest did nothing.
    context.manifest.tenants = tenants;

    return lines;
  },
};

export async function seedAuth(
  prisma: PrismaService,
  profile: Profile,
  apply: boolean,
): Promise<{ tenants: ManifestTenant[]; lines: string[] }> {
  const plans = (await prisma.subscriptionPlan.findMany({
    where: { deletedAt: null, isActive: true },
    orderBy: { maxAgentSeats: 'asc' },
    select: {
      id: true,
      name: true,
      maxAgentSeats: true,
      maxStorageBytes: true,
      maxDocumentUploads: true,
    },
  })) as PlanRow[];

  if (plans.length === 0) {
    throw new Error(
      'No rows in `subscription_plans`. Run `npm run plans:seed:apply` first — every seeded quantity is derived from a plan grant, so there is nothing to derive from.',
    );
  }

  // **The platform seed has to have run.** `DatabaseSeeder` writes the
  // permission catalogue and the global system roles at auth-service's boot,
  // and this seeder grants one of those roles to each tenant's admin. Checked
  // up front with a message that says what to do, because the alternative is
  // `findFirstOrThrow` failing three factories deep with "No record was
  // found" — true, and no help at all.
  const systemRoles = await prisma.role.count({
    where: { organizationId: null, isSystemRole: true },
  });

  if (systemRoles === 0) {
    throw new Error(
      'No global system roles in `roles`. Start auth-service once (`npm run dev`) so its DatabaseSeeder writes the permission catalogue and the system roles, then re-run.',
    );
  }

  // **No invitations are seeded, and the seat guarantee depends on it.**
  // `seatsInUse` counts live users PLUS pending invitations, so with none of
  // the second term the count equals the user count and `countFor`'s clamp is
  // the whole guarantee. Seed an invitation here and that stops being
  // structural — a tenant at exactly its grant plus two pending invites is over
  // its limit before anyone touches it, and nothing would say so.

  // **Hashed once, reused N times.** Every demo user shares one password, and
  // `BCRYPT_ROUNDS = 12` in the dev env means hashing per user is tens of
  // seconds of recomputing one string. No exception to the factory rule is
  // needed: `buildUser` spreads its overrides last, so `createUser` accepts the
  // digest directly and `createUserWithPassword` — the one that hashes per
  // call — simply is not the factory to use here.
  const passwordHash = await hashTestPassword(DEMO_PASSWORD);

  const tenants: ManifestTenant[] = [];
  const lines: string[] = [];

  for (let index = 0; index < profile.tenants; index++) {
    const plan = plans[index % plans.length];
    const shape = planTenant(plan, profile, index, index === 0);

    // A plan that grants no seats gets no tenant. Skipped rather than floored
    // at one user — see `planTenant`.
    if (shape.users === 0) {
      lines.push(
        `${shape.planName.padEnd(12)} skipped — the plan grants no seats`,
      );
      continue;
    }

    lines.push(
      `${shape.planName.padEnd(12)} ${String(shape.users).padStart(3)} users  ` +
        `${String(shape.documents).padStart(5)} docs  ` +
        `${(Number(shape.storageBytes) / 1024 ** 3).toFixed(2)} GiB  ` +
        `${shape.status}${shape.deleted ? ' (offboarded)' : ''}` +
        `${shape.entitlementsPinned ? ' (pinned)' : ''}`,
    );

    if (!apply) {
      // **A dry run still plans the later steps.** Their line counts come from
      // the manifest, so returning nothing here would print an empty ticket and
      // ingestion section — a dry run that shows a third of the run and reads
      // as though the rest does nothing.
      //
      // The ids are placeholders and cannot be written with: every step is
      // handed the same `apply: false`.
      tenants.push(plannedTenant(plan, shape, index));
      continue;
    }

    tenants.push(
      await prisma.$transaction(
        async (tx) =>
          writeTenant(tx as PrismaService, plan, shape, passwordHash, profile),
        { timeout: TRANSACTION_TIMEOUT_MS, maxWait: TRANSACTION_MAX_WAIT_MS },
      ),
    );
  }

  return { tenants, lines };
}

/** The manifest row a dry run reports, with ids nothing will write. */
function plannedTenant(
  plan: PlanRow,
  shape: TenantPlan,
  index: number,
): ManifestTenant {
  const placeholder = `dry-run-${index}`;

  return {
    organizationId: placeholder,
    name: `(planned ${shape.planName} tenant ${index})`,
    slug: `dry-run-${index}`,
    planName: shape.planName,
    grants: {
      maxAgentSeats: plan.maxAgentSeats,
      maxStorageBytes: plan.maxStorageBytes.toString(),
      maxDocumentUploads: plan.maxDocumentUploads,
    },
    planned: {
      documents: shape.documents,
      storageBytes: shape.storageBytes.toString(),
    },
    departmentIds: [placeholder],
    userIds: Array.from(
      { length: shape.users },
      (_, i) => `${placeholder}-user-${i}`,
    ),
    adminUserId: `${placeholder}-user-0`,
  };
}

async function writeTenant(
  tx: PrismaService,
  plan: PlanRow,
  shape: TenantPlan,
  passwordHash: string,
  profile: Profile,
): Promise<ManifestTenant> {
  const organization = await createOrganization(tx, {
    plan: { connect: { id: plan.id } },
    status: shape.status,
    maxAgentSeats: plan.maxAgentSeats,
    maxStorageBytes: plan.maxStorageBytes,
    maxDocumentUploads: plan.maxDocumentUploads,
    entitlementsPinned: shape.entitlementsPinned,
    // Stripe ids stay NULL — the grandfathered state the code handles
    // everywhere. A fake `cus_…` would send `listInvoices` at the real API.
    ...(shape.deleted ? { deletedAt: faker.date.recent({ days: 30 }) } : {}),
  });

  const department = await createDepartment(tx, organization.id);

  const userIds: string[] = [];
  for (let index = 0; index < shape.users; index++) {
    const user = await createUser(tx, {
      organizationId: organization.id,
      passwordHash,
      email: `user-${index}@${organization.slug}.demo.test`,
    });
    userIds.push(user.id);
  }

  // The first user is the tenant's admin, and every later step authors as one
  // of these — never as an id it invented.
  const adminRole = await findSystemRole(tx, SystemRoleName.ORG_ADMIN);
  await tx.user.update({
    where: { id: userIds[0] },
    data: { roles: { connect: { id: adminRole.id } } },
  });

  await writeBillingHistory(tx, organization.id, profile);

  return {
    organizationId: organization.id,
    name: organization.name,
    slug: organization.slug,
    planName: shape.planName,
    grants: {
      maxAgentSeats: plan.maxAgentSeats,
      maxStorageBytes: plan.maxStorageBytes.toString(),
      maxDocumentUploads: plan.maxDocumentUploads,
    },
    planned: {
      documents: shape.documents,
      storageBytes: shape.storageBytes.toString(),
    },
    departmentIds: [department.id],
    userIds,
    adminUserId: userIds[0],
  };
}

/**
 * `billing_events` spread over real dates, because a time series needs one.
 *
 * **Display-only and unreplayable, and that is worth knowing.** On the real
 * path a webhook resolves its tenant BY `stripe_customer_id`, which these
 * tenants deliberately do not have — so this history could never have been
 * produced by the integration that normally writes it. The finance dashboard
 * reads these rows by tenant id, which is what they are for.
 *
 * **`source` is left to its default.** It defaults to `STRIPE`, and writing
 * `LOCAL` here would take the row out of the staleness ordering — the exact
 * defect doc 63's validation found in the plan-change claim.
 */
async function writeBillingHistory(
  tx: PrismaService,
  organizationId: string,
  profile: Profile,
): Promise<void> {
  const events = Array.from({ length: profile.billingMonths }, (_, month) => {
    const occurredAt = new Date();
    occurredAt.setMonth(
      occurredAt.getMonth() - (profile.billingMonths - month),
    );

    // One failed payment in the middle, so the failed-payments figure is not
    // zero — an empty one makes a working dashboard look broken.
    const failed = month === Math.floor(profile.billingMonths / 2);

    return {
      // Prefixed so it cannot collide with a real `evt_…` and so a human
      // reading the table can tell which rows were invented.
      stripeEventId: `evt_demo_${organizationId.slice(0, 8)}_${month}`,
      organizationId,
      eventType: failed
        ? 'invoice.payment_failed'
        : 'customer.subscription.updated',
      stripeCreatedAt: occurredAt,
      payload: { demo: true, month },
      status: BillingEventStatus.PROCESSED,
    };
  });

  await tx.billingEvent.createMany({ data: events });
}
