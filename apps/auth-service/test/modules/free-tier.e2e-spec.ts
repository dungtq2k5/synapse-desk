import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FREE_TIER_ENTITLEMENTS,
  FREE_TIER_ORGANIZATION_GRANTS,
  OrgStatus,
} from '@synapsedesk/common';
import {
  E2eFixture,
  bootstrapE2eTest,
  requestOrigin,
  superAdminContext,
} from '../utils';
import { TEST_PASSWORD } from '../factories';
import { AuthService } from '../../src/modules/auth/auth.service';
import { PlatformService } from '../../src/modules/platform/platform.service';

/**
 * What a workspace gets with no subscription, asserted against the constant
 * rather than against numbers repeated here.
 *
 * These were seven `@default()`s in `schema.prisma` — invisible to every reader
 * of the create sites, and setting each new tenant to the PLATFORM CEILING on
 * four dimensions. The point of naming them is that "what does a new tenant
 * get" now has one answer with one place to change it, and this file is what
 * proves the create paths actually use it.
 */
describe('The free tier (e2e)', () => {
  let fx: E2eFixture;
  let auth: AuthService;
  let platform: PlatformService;

  const SUPER_ADMIN_ID = '00000000-0000-4000-8000-0000000000fe';

  /** Every column the free tier sets, read off one row. */
  const grantsOf = (row: Record<string, unknown>) => ({
    maxAgentSeats: row.maxAgentSeats,
    maxStorageBytes: row.maxStorageBytes,
    monthlyAiTokenBudget: row.monthlyAiTokenBudget,
    aiModelTier: row.aiModelTier,
    maxDocumentBytes: row.maxDocumentBytes,
    maxAttachmentBytes: row.maxAttachmentBytes,
    maxDocumentUploads: row.maxDocumentUploads,
    maxAnalyticsRangeDays: row.maxAnalyticsRangeDays,
  });

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    auth = fx.moduleRef.get(AuthService);
    platform = fx.moduleRef.get(PlatformService);
  });

  beforeEach(async () => {
    await fx.reset();
    await fx.prisma.user.upsert({
      where: { id: SUPER_ADMIN_ID },
      update: {},
      create: {
        id: SUPER_ADMIN_ID,
        organizationId: null,
        isSuperAdmin: true,
        email: 'free-tier-operator@example.test',
        fullName: 'Operator',
      },
    });
  });

  afterAll(() => fx.close());

  it('1. **A registration provisions exactly `FREE_TIER_ORGANIZATION_GRANTS`**', async () => {
    // Asserted against the CONSTANT, never against literals: a test carrying
    // its own copy of the numbers is a second definition of the free tier, and
    // the whole point of this work was collapsing that to one.
    const result = await auth.register(
      {
        email: 'founder@free-tier-one.test',
        password: TEST_PASSWORD,
        fullName: 'Founder',
      },
      requestOrigin(),
    );

    const organization = await fx.prisma.organization.findUniqueOrThrow({
      where: { id: result.organizationId },
    });

    expect(grantsOf(organization)).toEqual({
      ...FREE_TIER_ORGANIZATION_GRANTS,
    });
  });

  it('1b. **…and it is NOT the platform ceiling on the seats it sells**', async () => {
    // The finding behind this work: four columns defaulted to the platform
    // ceiling, so "the most the system permits" and "what you get for free"
    // were the same number. This pins that at least one dimension differs, so
    // a change collapsing them again is visible rather than silent.
    const result = await auth.register(
      {
        email: 'founder@free-tier-two.test',
        password: TEST_PASSWORD,
        fullName: 'Founder',
      },
      requestOrigin(),
    );

    const organization = await fx.prisma.organization.findUniqueOrThrow({
      where: { id: result.organizationId },
    });

    expect(organization.maxAgentSeats).toBe(
      FREE_TIER_ENTITLEMENTS.maxAgentSeats,
    );
    expect(organization.maxStorageBytes).toBe(
      FREE_TIER_ENTITLEMENTS.maxStorageBytes,
    );
  });

  it('2. **A platform create with NO overrides yields the same tenant**', async () => {
    // Two provisioning paths that differed would be a difference nobody chose
    // — and the schema default is exactly what used to hide it.
    const created = await platform.createOrganization(
      {
        name: 'Acme',
        slug: 'acme-free-tier',
        allowedEmailDomains: [],
        adminEmail: 'admin@acme-free.test',
        adminFullName: 'Admin',
      },
      superAdminContext(SUPER_ADMIN_ID),
    );

    const organization = await fx.prisma.organization.findUniqueOrThrow({
      where: { id: created.organization!.organization!.id },
    });

    expect(grantsOf(organization)).toEqual({
      ...FREE_TIER_ORGANIZATION_GRANTS,
    });
    expect(organization.status).toBe(OrgStatus.PENDING_ONBOARDING);
  });

  it('3. **A platform create WITH overrides keeps every one of them**', async () => {
    // The ordering bug this file exists for. `{ ...FREE_TIER, ...overrides }`
    // is correct; `{ ...overrides, ...FREE_TIER }` compiles, looks identical,
    // and silently discards every number a Super Admin typed. Only a create
    // that states an override distinguishes them.
    const created = await platform.createOrganization(
      {
        name: 'Negotiated',
        slug: 'negotiated-free-tier',
        allowedEmailDomains: [],
        adminEmail: 'admin@negotiated.test',
        adminFullName: 'Admin',
        maxAgentSeats: 250,
        maxStorageBytes: 999_999_999,
        monthlyAiTokenBudget: 88_000_000,
      },
      superAdminContext(SUPER_ADMIN_ID),
    );

    const organization = await fx.prisma.organization.findUniqueOrThrow({
      where: { id: created.organization!.organization!.id },
    });

    expect(organization.maxAgentSeats).toBe(250);
    expect(organization.maxStorageBytes).toBe(999_999_999n);
    expect(organization.monthlyAiTokenBudget).toBe(88_000_000n);
    // And the columns they did NOT mention still come from the free tier.
    expect(organization.maxDocumentUploads).toBe(
      FREE_TIER_ENTITLEMENTS.maxDocumentUploads,
    );
  });

  it('**No quota column carries a schema default** — asserted against the database', async () => {
    // Schema INTENT, and only that: this suite connects to the TEST database,
    // so it cannot see a divergence between it and dev — in the incident that
    // motivated this check, the test database was the one that succeeded.
    // `npm run db:verify` is what compares the two. What this pins is that the
    // decision holds wherever the suite runs: a default here silently answers
    // "what does a new tenant get" for a reader who never opens the schema.
    const rows = await fx.prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'organizations'
          AND column_name IN ('max_agent_seats','max_storage_bytes',
                              'monthly_ai_token_budget','max_document_bytes',
                              'max_attachment_bytes','max_document_uploads',
                              'max_analytics_range_days')
          AND column_default IS NOT NULL`,
    );

    expect(rows).toEqual([]);
  });

  it('**…and the SCHEMA does not declare one either** — caught at edit time', () => {
    // The database check above only sees a default once somebody pushes. This
    // one fails the moment it is typed, which is where the mistake is cheap:
    // the two guard the same decision at different times, and neither is the
    // other's duplicate.
    const schema = readFileSync(
      join(__dirname, '../../prisma/schema.prisma'),
      'utf8',
    );
    const organization = schema.slice(
      schema.indexOf('model Organization '),
      schema.indexOf('model ', schema.indexOf('model Organization ') + 10),
    );

    // The vacuity guard: a slice that missed would make every check below pass
    // over an empty string.
    expect(organization).toContain('maxAnalyticsRangeDays');
    expect(organization.length).toBeGreaterThan(500);

    for (const column of [
      'maxAgentSeats',
      'maxStorageBytes',
      'monthlyAiTokenBudget',
      'maxDocumentBytes',
      'maxAttachmentBytes',
      'maxDocumentUploads',
      'maxAnalyticsRangeDays',
    ]) {
      const line = organization
        .split('\n')
        .find((row) => row.trim().startsWith(`${column} `));

      expect(line).toBeDefined();
      expect(line).not.toContain('@default');
    }
  });

  it('…and all seven of them EXIST, which is the other half', async () => {
    // Without this, the check above passes over a table missing the columns
    // entirely — which is the exact state a refused push leaves behind.
    const rows = await fx.prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'organizations'
          AND column_name IN ('max_agent_seats','max_storage_bytes',
                              'monthly_ai_token_budget','max_document_bytes',
                              'max_attachment_bytes','max_document_uploads',
                              'max_analytics_range_days')`,
    );

    expect(rows).toHaveLength(7);
  });

  it('**The Free plan row exists, and its grants match the constant**', async () => {
    // `planId IS NULL` used to mean both "free" and "grandfathered with numbers
    // nobody chose". With this row, free is a plan — seeded from the same
    // constant the create paths spread, so the catalogue and the tenants cannot
    // disagree about what free is.
    const free = await fx.prisma.subscriptionPlan.findFirstOrThrow({
      where: { name: FREE_TIER_ENTITLEMENTS.displayName, deletedAt: null },
    });

    expect(grantsOf(free)).toEqual({ ...FREE_TIER_ORGANIZATION_GRANTS });
    // Assigned, never sold: invisible to Checkout by construction.
    expect(free.stripeProductId).toBeNull();
  });
});
