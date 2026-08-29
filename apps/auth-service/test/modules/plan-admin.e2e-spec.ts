import { status } from '@grpc/grpc-js';
import { expectRpc } from '@synapsedesk/common/testing/rpc';
import {
  AuditAction,
  AuditPublisher,
  PLAN_LIMIT_DIMENSIONS,
  JetStreamPublisher,
} from '@synapsedesk/common';
import { AiModelTier as ProtoAiModelTier } from '@synapsedesk/grpc-proto';
import {
  E2eFixture,
  bootstrapE2eTest,
  requestOrigin,
  superAdminContext,
} from '../utils';
import {
  TEST_PASSWORD,
  createOrganization,
  createUser,
  createUserWithPassword,
} from '../factories';
import { PlanAdminService } from '../../src/modules/billing/plan-admin.service';
import { BillingEventPublisher } from '../../src/modules/billing/billing-event.publisher';
import { InvitationsService } from '../../src/modules/invitations/invitations.service';
import { AuthService } from '../../src/modules/auth/auth.service';

/**
 * The catalogue as a Super Admin drives it, and the admission rule as behaviour.
 *
 * **A limit gates ADMISSION, never TENURE**, and that is the reason this file
 * exists. Lowering a plan limit under tenants who are already over it must
 * refuse their next addition and take away nothing they have — and the only way
 * to know that holds is to lower a limit under a tenant who is over it and
 * look.
 */
describe('The plan catalogue (e2e)', () => {
  let fx: E2eFixture;
  let plans: PlanAdminService;
  let invitations: InvitationsService;
  let auth: AuthService;
  let auditRecord: jest.SpyInstance;
  let publishEntitlementsChanged: jest.SpyInstance;
  let jetstreamPublish: jest.SpyInstance;

  const SUPER_ADMIN_ID = '00000000-0000-4000-8000-00000000beef';
  const context = () => superAdminContext(SUPER_ADMIN_ID);

  // Module-scoped and monotonic, per `development-conventions.md` §13.3:
  // increments across the whole suite
  // run, so two calls in one test never collide on a `@unique` column. A
  // counter is collision-FREE where six random base-36 characters are merely
  // unlikely — and it removes the question rather than answering it.
  let uniqueIndex = 0;

  /** A plan with room to move in both directions. */
  const buildPlan = async (overrides: Record<string, unknown> = {}) => {
    uniqueIndex += 1;

    return plans.createPlan(
      {
        name: `Plan ${uniqueIndex}`,
        stripeProductId: undefined,
        maxAgentSeats: 25,
        maxStorageBytes: 50 * 1024 * 1024 * 1024,
        monthlyAiTokenBudget: 10_000_000,
        aiModelTier: ProtoAiModelTier.AI_MODEL_TIER_QUALITY,
        maxDocumentBytes: 25 * 1024 * 1024,
        maxAttachmentBytes: 5 * 1024 * 1024,
        maxDocumentUploads: 10_000,
        maxAnalyticsRangeDays: 180,
        isActive: true,
        prices: [],
        ...overrides,
      },
      context(),
    );
  };

  /** A tenant ON that plan, with `count` active users holding seats. */
  const subscriberOf = async (planId: string, users = 0) => {
    const organization = await createOrganization(fx.prisma, {
      plan: { connect: { id: planId } },
    });

    for (let index = 0; index < users; index += 1) {
      await createUser(fx.prisma, { organizationId: organization.id });
    }

    return organization;
  };

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    plans = fx.moduleRef.get(PlanAdminService);
    invitations = fx.moduleRef.get(InvitationsService);
    auth = fx.moduleRef.get(AuthService);
  });

  beforeEach(async () => {
    await fx.reset();

    // The operator, as a REAL row. `subscription_plans.deleted_by_id` is a
    // `Restrict` foreign key, so a retire by an actor who is not in `users`
    // fails on the constraint — which is the schema working, not a test
    // problem, and the fixture has to be honest about it.
    //
    // An UPSERT because `reset()` deliberately preserves platform accounts:
    // `DELETE FROM users WHERE organization_id IS NOT NULL` leaves this one
    // standing, so a plain create collides on the second test.
    await fx.prisma.user.upsert({
      where: { id: SUPER_ADMIN_ID },
      update: {},
      create: {
        id: SUPER_ADMIN_ID,
        organizationId: null,
        isSuperAdmin: true,
        email: 'plan-admin-operator@example.test',
        fullName: 'Plan Operator',
      },
    });

    // Audit and entitlement announcements are fire-and-forget over NATS, which
    // is not running here. Spied rather than stubbed away: two tests assert on
    // what they were called with.
    //
    // `mockClear` after each spy, because `jest.spyOn` on an ALREADY-spied
    // method hands back the same mock with its call history intact — so
    // without this a "was never called" assertion reads the previous test's
    // calls and fails for the wrong reason.
    auditRecord = jest
      .spyOn(fx.moduleRef.get(AuditPublisher), 'record')
      .mockImplementation(() => undefined);
    auditRecord.mockClear();
    // **Spied, not stubbed** — the plan-changed notice is built inside this
    // method, so replacing it deletes the thing test 4c is about. The real one
    // runs and the transport below is what gets replaced.
    publishEntitlementsChanged = jest.spyOn(
      fx.moduleRef.get(BillingEventPublisher),
      'publishEntitlementsChanged',
    );
    publishEntitlementsChanged.mockClear();
    jetstreamPublish = jest
      .spyOn(fx.moduleRef.get(JetStreamPublisher), 'publish')
      .mockImplementation(() => undefined);
    jetstreamPublish.mockClear();
  });

  afterAll(() => fx.close());

  // ---------------------------------------------------------------- A limit gates admission, never tenure

  describe('The admission rule', () => {
    it('1. **Lowering a limit DELETES, DEACTIVATES and UNINDEXES nothing**', async () => {
      // The rule the whole decision rests on, stated as the thing that must not
      // happen. Ten users on a plan that drops to three seats: an enforcement
      // design that swept totals would have to choose seven people to remove,
      // and this asserts that no such code exists to choose them.
      const plan = await buildPlan({ maxAgentSeats: 25 });
      const organization = await subscriberOf(plan.id, 10);

      await plans.updatePlan(
        { planId: plan.id, maxAgentSeats: 3 } as never,
        context(),
      );
      await plans.applyPlan({ planId: plan.id, dryRun: false }, context());

      const users = await fx.prisma.user.findMany({
        where: { organizationId: organization.id },
      });

      expect(users).toHaveLength(10);
      expect(users.every((user) => user.deletedAt === null)).toBe(true);
      expect(users.every((user) => user.isLocked === false)).toBe(true);
    });

    it('2. **…and the tenant is refused the NEXT seat, with a named reason**', async () => {
      // The other half. Test 1 alone passes for a system that lowered the
      // number and then enforced nothing at all, which would be a different bug
      // wearing the same green.
      const plan = await buildPlan({ maxAgentSeats: 25 });
      const organization = await subscriberOf(plan.id, 4);
      const inviter = await createUser(fx.prisma, {
        organizationId: organization.id,
      });

      await plans.updatePlan(
        { planId: plan.id, maxAgentSeats: 3 } as never,
        context(),
      );
      await plans.applyPlan({ planId: plan.id, dryRun: false }, context());

      // Five users hold seats on a plan that now grants three.
      const result = await invitations.createInvitations(
        {
          organizationId: organization.id,
          invitedById: inviter.id,
          invitations: [
            {
              email: 'over-limit@example.test',
              roleIds: [],
              departmentIds: [],
            },
          ],
        },
        { ip: '127.0.0.1', userAgent: 'jest' },
      );

      expect(result.created).toHaveLength(0);
      expect(result.failed).toHaveLength(1);
      // **Named.** "Failed" alone sends an admin to the logs; the reason is
      // what lets them fix it themselves by freeing a seat or upgrading.
      expect(result.failed[0].reason).toMatch(/seat/i);
    });

    it('3. **An over-seat tenant’s existing agents keep their accounts**', async () => {
      // Tenure, specifically. Seats are the one entitlement where a tenant's
      // holding is CONTINUOUS rather than created once, so it is the field
      // where a retroactive sweep would be most tempting and most damaging: a
      // locked account is a person who cannot work.
      const plan = await buildPlan({ maxAgentSeats: 25 });
      const organization = await subscriberOf(plan.id, 8);
      const agent = await createUserWithPassword(fx.prisma, {
        organizationId: organization.id,
      });

      await plans.updatePlan(
        { planId: plan.id, maxAgentSeats: 1 } as never,
        context(),
      );
      await plans.applyPlan({ planId: plan.id, dryRun: false }, context());

      const active = await fx.prisma.user.count({
        where: {
          organizationId: organization.id,
          deletedAt: null,
          isLocked: false,
        },
      });

      // Nine of them, on a plan that grants a single seat.
      expect(active).toBe(9);

      // **Logging in, not merely "the row still looks fine".** An account can
      // be unlocked and undeleted and still be refused at the door by a seat
      // check somebody added to the login path, which is exactly the shape the
      // admission rule forbids — and only an actual login proves it did not happen.
      const session = await auth.login(
        { email: agent.email, password: TEST_PASSWORD },
        requestOrigin(),
      );

      expect(session.accessToken).toBeTruthy();
    });

    it('4. **A budget REDUCTION is not applied; an increase is**', async () => {
      // The one exception to that rule, and the reason it is one: a budget is
      // periodic by definition, so lowering a part-spent one mid-cycle takes
      // away allowance the tenant has already been spending against. It waits
      // for the cycle roll, where the next subscription event re-derives every
      // grant anyway.
      const plan = await buildPlan({ monthlyAiTokenBudget: 10_000_000 });
      const organization = await subscriberOf(plan.id);

      await fx.prisma.organization.update({
        where: { id: organization.id },
        data: { monthlyAiTokenBudget: 10_000_000n },
      });

      await plans.updatePlan(
        { planId: plan.id, monthlyAiTokenBudget: 1_000_000 } as never,
        context(),
      );
      const lowered = await plans.applyPlan(
        { planId: plan.id, dryRun: false },
        context(),
      );

      const afterCut = await fx.prisma.organization.findUniqueOrThrow({
        where: { id: organization.id },
      });

      expect(afterCut.monthlyAiTokenBudget).toBe(10_000_000n);
      expect(lowered.subscribers[0].budgetDeferred).toBe(true);
      // Reported, not hidden: an operator must see a deferred cut rather than
      // meet it weeks later.
      expect(lowered.subscribers[0].changes).toHaveProperty(
        'monthlyAiTokenBudget',
      );

      // The other direction lands immediately — arriving early at a LARGER
      // allowance harms nobody.
      await plans.updatePlan(
        { planId: plan.id, monthlyAiTokenBudget: 99_000_000 } as never,
        context(),
      );
      const raised = await plans.applyPlan(
        { planId: plan.id, dryRun: false },
        context(),
      );

      const afterRaise = await fx.prisma.organization.findUniqueOrThrow({
        where: { id: organization.id },
      });

      expect(afterRaise.monthlyAiTokenBudget).toBe(99_000_000n);
      expect(raised.subscribers[0].budgetDeferred).toBe(false);
    });
  });

  // ---------------------------------------------------------------- Explicit, never implicit

  describe('Applying an edit', () => {
    it('8. **An EDIT alone changes no subscriber; APPLY is what changes them**', async () => {
      // A silent fan-out on save would rewrite two hundred tenants'
      // entitlements from a form submit. The explicit step is what makes the
      // blast radius something a person saw rather than discovered.
      const plan = await buildPlan({ maxAgentSeats: 25 });
      const organization = await subscriberOf(plan.id);

      await plans.updatePlan(
        { planId: plan.id, maxAgentSeats: 7 } as never,
        context(),
      );

      const untouched = await fx.prisma.organization.findUniqueOrThrow({
        where: { id: organization.id },
      });
      expect(untouched.maxAgentSeats).not.toBe(7);
      expect(publishEntitlementsChanged).not.toHaveBeenCalled();

      await plans.applyPlan({ planId: plan.id, dryRun: false }, context());

      const applied = await fx.prisma.organization.findUniqueOrThrow({
        where: { id: organization.id },
      });
      expect(applied.maxAgentSeats).toBe(7);
      // The same announcement the webhook path makes, for the same consumers,
      // with the change id derived from the PLAN's `updatedAt` — every
      // subscriber in one apply shares it, and a retried apply collapses onto
      // one notice per tenant rather than minting a second.
      expect(publishEntitlementsChanged).toHaveBeenCalledWith(
        organization.id,
        expect.stringContaining(`apply:${plan.id}:`),
      );
    });

    it('9. **A DRY RUN reports exactly what the apply then does — and writes nothing**', async () => {
      // A dry run computed by different code from the apply it predicts is
      // worse than no dry run: it would be believed, and it would be believed
      // precisely when it was wrong. Asserted as EQUALITY of the projections,
      // not as "both mention the tenant".
      const plan = await buildPlan({ maxAgentSeats: 25 });
      const first = await subscriberOf(plan.id, 30);
      const second = await subscriberOf(plan.id);
      const pinned = await subscriberOf(plan.id);

      await fx.prisma.organization.update({
        where: { id: pinned.id },
        data: { entitlementsPinned: true },
      });
      await plans.updatePlan(
        { planId: plan.id, maxAgentSeats: 9 } as never,
        context(),
      );

      const projected = await plans.applyPlan(
        { planId: plan.id, dryRun: true },
        context(),
      );

      // Nothing moved, and nothing was announced.
      const stillOld = await fx.prisma.organization.findUniqueOrThrow({
        where: { id: second.id },
      });
      expect(stillOld.maxAgentSeats).not.toBe(9);
      expect(publishEntitlementsChanged).not.toHaveBeenCalled();

      const applied = await plans.applyPlan(
        { planId: plan.id, dryRun: false },
        context(),
      );

      expect(applied.subscribers).toEqual(projected.subscribers);
      expect(applied.changedCount).toBe(projected.changedCount);
      expect(applied.overLimitCount).toBe(projected.overLimitCount);
      expect(applied.skippedPinnedCount).toBe(projected.skippedPinnedCount);

      // And the projection said something true about each of the three.
      const byId = new Map(
        projected.subscribers.map((row) => [row.organizationId, row]),
      );
      expect(byId.get(pinned.id)?.skippedPinned).toBe(true);
      expect(byId.get(first.id)?.overLimit.length).toBeGreaterThan(0);
      expect(byId.get(second.id)?.overLimit).toEqual([]);
    });

    it('4. **An apply over N subscribers notifies N tenants, one each**', async () => {
      // The fan-out shape. Two failures are available and they are opposites:
      // deduping on the PLAN collapses 200 tenants into one notification only
      // the first receives, and no dedupe at all republishes the same id for
      // every apply. The id carries the ORGANIZATION and the timestamp, so
      // neither happens.
      const plan = await buildPlan({ maxAgentSeats: 25 });
      const first = await subscriberOf(plan.id);
      const second = await subscriberOf(plan.id);
      const third = await subscriberOf(plan.id);

      await plans.updatePlan(
        { planId: plan.id, maxAgentSeats: 9 } as never,
        context(),
      );
      await plans.applyPlan({ planId: plan.id, dryRun: false }, context());

      // One per tenant, and every tenant distinct — asserted as a SET, because
      // three calls carrying one organization id would satisfy a bare count.
      const notified = publishEntitlementsChanged.mock.calls.map(
        (call) => call[0] as string,
      );
      expect(new Set(notified)).toEqual(
        new Set([first.id, second.id, third.id]),
      );
      expect(notified).toHaveLength(3);
    });

    it('4c. …and each tenant’s NOTICE carries its own event id', async () => {
      // The assertion above measures the fan-out. This measures the
      // notification inside it, which is a different property: an id keyed on
      // the plan rather than the tenant gives three subscribers one id, and
      // Domain E's unique index is `(recipient_id, event_id)` — so the second
      // and third tenants' admins would be deduplicated against the first.
      const plan = await buildPlan({ maxAgentSeats: 25 });
      const first = await subscriberOf(plan.id);
      const second = await subscriberOf(plan.id);

      await plans.updatePlan(
        { planId: plan.id, maxAgentSeats: 9 } as never,
        context(),
      );
      await plans.applyPlan({ planId: plan.id, dryRun: false }, context());

      const notices = jetstreamPublish.mock.calls
        .map(([, command, messageId]) => [
          command as { organizationId: string; eventId: string },
          messageId as string,
        ])
        .filter(([command]) =>
          (command as { eventId: string }).eventId.startsWith('plan-changed:'),
        ) as [{ organizationId: string; eventId: string }, string][];

      expect(notices).toHaveLength(2);
      expect(
        new Set(notices.map(([command]) => command.organizationId)),
      ).toEqual(new Set([first.id, second.id]));
      expect(new Set(notices.map(([command]) => command.eventId)).size).toBe(2);
      // Message id and durable id are one string, as everywhere else.
      for (const [command, messageId] of notices) {
        expect(messageId).toBe(command.eventId);
      }
    });

    it('4b. …and a DRY RUN notifies nobody', async () => {
      // A projection that told two hundred tenants their plan changed would be
      // the worst possible way to discover the dry run was not dry.
      const plan = await buildPlan({ maxAgentSeats: 25 });
      await subscriberOf(plan.id);

      await plans.updatePlan(
        { planId: plan.id, maxAgentSeats: 9 } as never,
        context(),
      );
      await plans.applyPlan({ planId: plan.id, dryRun: true }, context());

      expect(publishEntitlementsChanged).not.toHaveBeenCalled();
    });

    it('2. **The response says which limits it CHECKED — storage is not one**', async () => {
      // The inversion this field exists to prevent. `overLimitCount` counts
      // seat overruns only, and without `evaluatedDimensions` a zero there is
      // indistinguishable from a working check that found nobody — which is a
      // stronger claim than "we did not look", and the one a Super Admin acts
      // on when they lower a storage limit.
      const plan = await buildPlan();
      await subscriberOf(plan.id);

      const projected = await plans.applyPlan(
        { planId: plan.id, dryRun: true },
        context(),
      );

      expect(projected.evaluatedDimensions).toContain('seats');
      // Neither of ingestion's dimensions, and permanently so at THIS layer:
      // both are counted from `ingestion-service`'s tables, and auth cannot ask
      // — ingestion dials auth on every presign, so the reverse edge would close
      // a cycle. The gateway composes them and unions its own coverage in.
      expect(projected.evaluatedDimensions).not.toContain('storage');
      expect(projected.evaluatedDimensions).not.toContain('documents');

      // **Stated against the whole vocabulary, not as a hardcoded pair.** The
      // list is only meaningful against what there IS to check, so this asserts
      // the difference rather than the contents: every dimension the run did
      // not evaluate is a dimension the counts say nothing about.
      const unevaluated = PLAN_LIMIT_DIMENSIONS.filter(
        (dimension) => !projected.evaluatedDimensions.includes(dimension),
      );
      expect(unevaluated).toEqual(['storage', 'documents']);
    });

    it('2b. …and the apply reports the same coverage as its dry run', async () => {
      // A dry run that claimed a dimension the apply did not check would be a
      // subtler version of the same lie.
      const plan = await buildPlan();
      await subscriberOf(plan.id, 2);

      const projected = await plans.applyPlan(
        { planId: plan.id, dryRun: true },
        context(),
      );
      const applied = await plans.applyPlan(
        { planId: plan.id, dryRun: false },
        context(),
      );

      expect(applied.evaluatedDimensions).toEqual(
        projected.evaluatedDimensions,
      );
    });

    it('9b. A pinned subscriber is skipped by the apply itself, not just the projection', async () => {
      // The projection could be right while the write ignored it.
      const plan = await buildPlan({ maxAgentSeats: 25 });
      const pinned = await subscriberOf(plan.id);
      const negotiated = 512;

      await fx.prisma.organization.update({
        where: { id: pinned.id },
        data: { entitlementsPinned: true, maxAgentSeats: negotiated },
      });
      await plans.updatePlan(
        { planId: plan.id, maxAgentSeats: 9 } as never,
        context(),
      );
      await plans.applyPlan({ planId: plan.id, dryRun: false }, context());

      const after = await fx.prisma.organization.findUniqueOrThrow({
        where: { id: pinned.id },
      });

      expect(after.maxAgentSeats).toBe(negotiated);
      expect(publishEntitlementsChanged).not.toHaveBeenCalled();
    });

    it('**An apply audits, and a DRY RUN does not**', async () => {
      // Plan administration writes to `audit_logs`, never to
      // `billing_events` — that table is a Stripe webhook ledger whose unique
      // `evt_…` id IS its idempotency mechanism, and a Super Admin edit has
      // none. A dry run changed nothing and has nothing to record.
      const plan = await buildPlan();
      await subscriberOf(plan.id);
      auditRecord.mockClear();

      await plans.applyPlan({ planId: plan.id, dryRun: true }, context());
      expect(
        auditRecord.mock.calls.filter(
          (call) => call[1].action === AuditAction.PLATFORM_PLAN_APPLIED,
        ),
      ).toHaveLength(0);

      await plans.applyPlan({ planId: plan.id, dryRun: false }, context());

      const applied = auditRecord.mock.calls.find(
        (call) => call[1].action === AuditAction.PLATFORM_PLAN_APPLIED,
      );
      expect(applied).toBeDefined();
      // The blast radius, recorded at the moment somebody accepted it.
      expect(applied?.[1].metadata).toHaveProperty('overLimitCount');
      expect(applied?.[1].organizationId).toBeNull();

      const billingEvents = await fx.prisma.billingEvent.count();
      expect(billingEvents).toBe(0);
    });
  });

  // ---------------------------------------------------------------- The catalogue row

  describe('The catalogue row', () => {
    it('11. **A plan with live subscribers cannot be DELETED**', async () => {
      // Deactivate instead. A deleted plan with subscribers leaves
      // `organizations.plan_id` pointing at a row every read filters out, and
      // those tenants' entitlements would have no explanation anywhere.
      const plan = await buildPlan();
      await subscriberOf(plan.id);

      await expectRpc(
        plans.deletePlan(plan.id, context()),
        status.FAILED_PRECONDITION,
      );

      const survivor = await fx.prisma.subscriptionPlan.findUniqueOrThrow({
        where: { id: plan.id },
      });
      expect(survivor.deletedAt).toBeNull();
    });

    it('11b. …and CAN be deleted once nobody is on it, recording who did it', async () => {
      // The complement: a refusal that never lifts is a catalogue that only
      // grows.
      const plan = await buildPlan();

      await expect(plans.deletePlan(plan.id, context())).resolves.toBe(true);

      const retired = await fx.prisma.subscriptionPlan.findUniqueOrThrow({
        where: { id: plan.id },
      });
      expect(retired.deletedAt).not.toBeNull();
      // WHO retired it, on a `Restrict` relation — the decision does not go
      // anonymous.
      expect(retired.deletedById).toBe(SUPER_ADMIN_ID);
      // And it is off the pricing page as well as out of every read.
      expect(retired.isActive).toBe(false);
    });

    it('A retired plan is invisible to reads, and cannot be applied', async () => {
      const plan = await buildPlan();
      await plans.deletePlan(plan.id, context());

      const listed = await plans.listPlans(
        { page: undefined } as never,
        context(),
      );
      expect(listed.items.map((row) => row.id)).not.toContain(plan.id);

      await expectRpc(
        plans.applyPlan({ planId: plan.id, dryRun: true }, context()),
        status.NOT_FOUND,
      );
    });

    it('An UPDATE touching one grant leaves the others alone', async () => {
      // The `undefined` means "leave it" rule. A PATCH that reset unmentioned
      // grants to a proto zero would empty a catalogue row from a form that
      // touched one field — and the row would still look plausible.
      const plan = await buildPlan({
        maxAgentSeats: 25,
        maxStorageBytes: 50 * 1024 * 1024 * 1024,
        maxDocumentBytes: 25 * 1024 * 1024,
      });

      await plans.updatePlan(
        { planId: plan.id, maxAgentSeats: 30 } as never,
        context(),
      );

      const after = await fx.prisma.subscriptionPlan.findUniqueOrThrow({
        where: { id: plan.id },
      });

      expect(after.maxAgentSeats).toBe(30);
      expect(after.maxStorageBytes).toBe(BigInt(50 * 1024 * 1024 * 1024));
      expect(after.maxDocumentBytes).toBe(BigInt(25 * 1024 * 1024));
      expect(after.monthlyAiTokenBudget).toBe(10_000_000n);
    });

    it('A plan with NO Stripe product is legal — the negotiated agreement', async () => {
      // Assignable by us, invisible to self-service, and legal on purpose.
      const plan = await buildPlan({ stripeProductId: undefined });

      expect(plan.stripeProductId).toBeUndefined();

      const row = await fx.prisma.subscriptionPlan.findUniqueOrThrow({
        where: { id: plan.id },
      });
      expect(row.stripeProductId).toBeNull();
    });
  });
});
