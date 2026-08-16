import { RpcException } from '@nestjs/microservices';
import { waitUntil } from '@synapsedesk/common/testing/wait';
import { status } from '@grpc/grpc-js';
import { faker } from '@faker-js/faker';
import Redis from 'ioredis';
import {
  AiGenerationOutcome,
  AiGenerationPurpose,
  AiGenerationStatus,
  AiSurface,
  AtCapAction,
  EMBEDDING_MODEL,
  estimateCostMicros,
  GENERATION_MODEL_BY_TIER,
  IN_APP_NOTIFICATION_PATTERN,
  NotificationPriority,
  quotaCounterKey,
  quotaThresholdEventId,
  readHttpStatusHint,
  NATS_CLIENT,
} from '@synapsedesk/common';
import {
  BUDGET_MICROS,
  CYCLE_START,
  E2eFixture,
  bootstrapE2eTest,
  memberContext,
} from '../utils';
import { buildTenant, TenantFixture } from '../factories';
import { AiLedgerService } from '../../src/modules/ai-ledger/ai-ledger.service';
import {
  QUOTA_REDIS,
  QuotaCounterService,
} from '../../src/modules/ai-ledger/quota-counter.service';
import { AuthReferenceService } from '../../src/modules/auth-client/auth-reference.service';
import { faultInjector } from '@synapsedesk/common/testing/fault';

describe('§1.3 The AI ledger and quota gate (e2e)', () => {
  // Every injected fault in this file is registered here and restored in an
  // `afterEach` that runs whether the test passed, failed or threw
  const faults = faultInjector();

  let fx: E2eFixture;
  let ledger: AiLedgerService;
  let counter: QuotaCounterService;
  let redis: Redis;
  let authReference: AuthReferenceService;

  let getAiEntitlement: jest.SpyInstance;
  let natsEmit: jest.SpyInstance;

  let tenant: TenantFixture;

  const context = () =>
    memberContext({ id: tenant.userId, organizationId: tenant.organizationId });

  const entry = (overrides: Record<string, unknown> = {}) => ({
    organizationId: tenant.organizationId,
    userId: tenant.userId,
    purpose: AiGenerationPurpose.CHAT_ANSWER,
    modelName: GENERATION_MODEL_BY_TIER.FAST,
    promptTokens: 1_000,
    completionTokens: 500,
    ...overrides,
  });

  /** Puts the tenant at an exact spend, bypassing `charge`. */
  const setSpend = (micros: bigint) =>
    redis.set(
      quotaCounterKey(tenant.organizationId, CYCLE_START),
      micros.toString(),
    );

  /** Waits for the fire-and-forget ledger write to land. */
  const waitForRows = (expected: number, timeoutMs = 2_000): Promise<boolean> =>
    waitUntil(
      async () => (await fx.prisma.aiGeneration.count()) >= expected,
      timeoutMs,
    );

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    ledger = fx.moduleRef.get(AiLedgerService);
    counter = fx.moduleRef.get(QuotaCounterService);
    redis = fx.moduleRef.get<Redis>(QUOTA_REDIS);
    authReference = fx.moduleRef.get(AuthReferenceService);

    // auth-service is not running for this suite; the entitlement it would
    // return is the one variable every test here wants to control anyway.
    getAiEntitlement = jest.spyOn(authReference, 'getAiEntitlement');

    // NATS is not running either. The alert path is fire-and-forget, so a real
    // publish would fail silently and prove nothing.
    const client = fx.moduleRef.get<{ emit: (...args: unknown[]) => unknown }>(
      NATS_CLIENT,
      { strict: false },
    );
    natsEmit = jest
      .spyOn(client, 'emit')
      .mockReturnValue({ subscribe: () => undefined });
  });

  beforeEach(async () => {
    await fx.reset();
    await redis.flushdb();
    jest.clearAllMocks();

    getAiEntitlement.mockResolvedValue({
      budgetMicros: BUDGET_MICROS,
      billingCycleStart: CYCLE_START,
    });
    natsEmit.mockReturnValue({ subscribe: () => undefined });

    tenant = buildTenant();
  });

  afterAll(() => fx.close());

  // ----------------------------------------------------------------- the gate

  describe('the budget gate', () => {
    it('1. passes under budget and refuses over it — §1.3 test 1', async () => {
      const under = await ledger.checkBudget(
        tenant.organizationId,
        AiSurface.DRAFT,
        context(),
      );
      expect(under.allowed).toBe(true);

      await setSpend(BUDGET_MICROS);
      const over = await ledger.checkBudget(
        tenant.organizationId,
        AiSurface.DRAFT,
        context(),
      );
      expect(over.allowed).toBe(false);
    });

    it('2. reads REDIS, never SUM(estimated_cost_micros)', async () => {
      // The sum is the DEFINITION of spend and a growing scan on the hot path.
      // A ledger full of rows with an empty counter must read as zero spent —
      // which looks wrong until you remember reconciliation is what makes them
      // agree, and that it runs on a schedule rather than per request.
      for (let i = 0; i < 5; i++) {
        await fx.prisma.aiGeneration.create({
          data: {
            organizationId: tenant.organizationId,
            purpose: AiGenerationPurpose.EMBEDDING,
            modelName: EMBEDDING_MODEL,
            estimatedCostMicros: BUDGET_MICROS,
          },
        });
      }

      const decision = await ledger.checkBudget(
        tenant.organizationId,
        AiSurface.DRAFT,
        context(),
      );

      expect(decision.allowed).toBe(true);
      expect(decision.spentMicros).toBe(0n);
    });

    it('3. asks the gateway for 402 on a REFUSE surface', async () => {
      // Not 403 — the caller is permitted, they have run out of allowance, and
      // 403 would send an admin looking at role grants. Not 429 either, which
      // says slow down rather than buy more.
      //
      // The status rides in the MESSAGE because extra fields on an
      // RpcException do not survive the gRPC wire — a `httpStatus` property
      // would be silently dropped and the gateway would fall back to 429. That
      // silent drop is exactly why this asserts the marker rather than a field.
      await setSpend(BUDGET_MICROS);

      const attempt = ledger.assertWithinBudget(
        tenant.organizationId,
        AiSurface.DRAFT,
        context(),
      );

      await expect(attempt).rejects.toBeInstanceOf(RpcException);
      await attempt.catch((error: unknown) => {
        const payload = (error as RpcException).getError() as {
          code: number;
          message: string;
        };
        expect(payload.code).toBe(status.RESOURCE_EXHAUSTED);
        expect(readHttpStatusHint(payload.message)).toEqual({
          httpStatus: 402,
          message: expect.stringContaining('AI allowance'),
        });
      });
    });

    it('4. REFUSES to assert on a non-REFUSE surface', async () => {
      // Chat escalates and search degrades. A caller that asserted on those
      // would turn a product behaviour into an error, so the misuse is loud.
      await setSpend(BUDGET_MICROS);

      await expect(
        ledger.assertWithinBudget(
          tenant.organizationId,
          AiSurface.CHAT_ANSWER,
          context(),
        ),
      ).rejects.toThrow(/read the decision from checkBudget/);
    });

    it('5. returns the SURFACE-SPECIFIC action at the cap', async () => {
      // The whole reason the gate takes a surface. A boolean cannot express
      // "chat escalates, search degrades, ingestion defers, drafts refuse", and
      // a caller left to interpret a bare throw gets it wrong differently in
      // each service.
      await setSpend(BUDGET_MICROS);

      const expected: [AiSurface, AtCapAction][] = [
        [AiSurface.CHAT_ANSWER, AtCapAction.ESCALATE],
        [AiSurface.KNOWLEDGE_SEARCH, AtCapAction.DEGRADE],
        [AiSurface.INGESTION_EMBEDDING, AtCapAction.DEFER],
        [AiSurface.DRAFT, AtCapAction.REFUSE],
        [AiSurface.GREETING_CLASSIFY, AtCapAction.REFUSE],
      ];

      for (const [surface, action] of expected) {
        const decision = await ledger.checkBudget(
          tenant.organizationId,
          surface,
          context(),
        );
        expect([surface, decision]).toEqual([
          surface,
          expect.objectContaining({ allowed: false, action }),
        ]);
      }
    });

    it('6. gives the ESCALATION summary a bounded 10% grace', async () => {
      // At the cap two failures compound: deflection stops so ticket volume
      // spikes, and every one of those tickets arrives without a summary
      // because summaries are an AI surface too. The escalation summary is the
      // cheapest call the system makes and has its highest marginal value
      // exactly when the queue is flooded.
      await setSpend(BUDGET_MICROS + 50_000n);

      const inGrace = await ledger.checkBudget(
        tenant.organizationId,
        AiSurface.ESCALATION_SUMMARY,
        context(),
      );
      const manual = await ledger.checkBudget(
        tenant.organizationId,
        AiSurface.MANUAL_SUMMARY,
        context(),
      );

      expect(inGrace.allowed).toBe(true);
      // A manual summary is discretionary and gets no grace, which is what
      // makes the exception targeted rather than a hole.
      expect(manual.allowed).toBe(false);
    });

    it('7. the grace is BOUNDED — past 110% summaries stop too', async () => {
      // An unbounded exemption is not a cap.
      await setSpend(BUDGET_MICROS + 200_000n);

      const decision = await ledger.checkBudget(
        tenant.organizationId,
        AiSurface.ESCALATION_SUMMARY,
        context(),
      );

      expect(decision.allowed).toBe(false);
    });

    it('8. FAILS CLOSED when Redis is unreachable — §1.3 test 8', async () => {
      // The one place a cache miss must not mean "allow". Returning zero on a
      // connection error would open the gate for every tenant at once, at
      // exactly the moment nobody can see what is being spent.
      faults.fail(counter, 'spentMicros', new Error('ECONNREFUSED'));

      const decision = await ledger.checkBudget(
        tenant.organizationId,
        AiSurface.DRAFT,
        context(),
      );

      expect(decision.allowed).toBe(false);
    });

    it('8b. FAILS CLOSED when AUTH-SERVICE is unreachable — 16-doc §4', async () => {
      // The row to check first, and the one that goes the
      // OPPOSITE way from `listDepartments`.
      //
      // `listDepartments` returning empty on an unreachable auth-service is a
      // good decision for classification: a convenience degrades and the ticket
      // still gets filed. The same decision applied to the entitlement read
      // would be a disaster — a tenant whose budget cannot be fetched must not
      // be treated as unlimited, because that spends money that may not exist
      // and does so at the moment nobody can see the meter.
      //
      // The two are meant to disagree, so both directions are pinned.
      // The suite's own spy, not the fault injector: `getAiEntitlement` is
      // already spied in `beforeAll`, and `jest.spyOn` on an existing mock
      // returns that same instance — so restoring it would strip the shared
      // spy for every later test. `beforeEach` re-states the implementation,
      // which is what makes this safe.
      getAiEntitlement.mockRejectedValue(
        new Error('auth-service is unreachable'),
      );

      await expect(
        ledger.checkBudget(tenant.organizationId, AiSurface.DRAFT, context()),
      ).rejects.toBeDefined();
    });

    it('9. still ESCALATES chat during a Redis outage, rather than erroring', async () => {
      // Failing closed must not turn into failing hard: a user mid-conversation
      // gets a human, not a stack trace.
      faults.fail(counter, 'spentMicros', new Error('ECONNREFUSED'));

      const decision = await ledger.checkBudget(
        tenant.organizationId,
        AiSurface.CHAT_ANSWER,
        context(),
      );

      expect(decision).toMatchObject({
        allowed: false,
        action: AtCapAction.ESCALATE,
      });
    });

    it('10. a cycle ROLL makes the tenant immediately under budget — §1.3 test 5', async () => {
      // The cycle start is in the Redis key, so a billing reset invalidates the
      // counter for free — no cache bust, no migration, no job.
      await setSpend(BUDGET_MICROS);
      expect(
        (
          await ledger.checkBudget(
            tenant.organizationId,
            AiSurface.DRAFT,
            context(),
          )
        ).allowed,
      ).toBe(false);

      getAiEntitlement.mockResolvedValue({
        budgetMicros: BUDGET_MICROS,
        billingCycleStart: new Date('2026-09-01T00:00:00.000Z'),
      });

      expect(
        (
          await ledger.checkBudget(
            tenant.organizationId,
            AiSurface.DRAFT,
            context(),
          )
        ).allowed,
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------- the charge

  describe('charge', () => {
    it('1. is SYNCHRONOUS — N concurrent requests, room for one — §1.3 test 2', async () => {
      // THE burst test, and the reason `charge()` is awaited. With an
      // asynchronous increment all N read the same stale value, all pass the
      // gate and all spend; reconciliation reports the overrun after the money
      // is gone.
      //
      // Each request charges a fifth of the budget and re-checks, so exactly
      // one can find room if the increment is truly serialised.
      await setSpend(BUDGET_MICROS - 200_000n);
      const cost = 200_000n;

      const attempts = await Promise.all(
        Array.from({ length: 5 }, async () => {
          const decision = await ledger.checkBudget(
            tenant.organizationId,
            AiSurface.DRAFT,
            context(),
          );
          if (!decision.allowed) return 'refused' as const;
          await ledger.charge(tenant.organizationId, cost, context());
          return 'spent' as const;
        }),
      );

      // The counter is what must be right: whatever raced through the gate, the
      // recorded total equals the sum of what was actually charged. A
      // fire-and-forget increment loses charges here and reports less.
      const spent = await counter.spentMicros(
        tenant.organizationId,
        CYCLE_START,
      );
      const spentCount = attempts.filter((a) => a === 'spent').length;
      expect(spent).toBe(BUDGET_MICROS - 200_000n + cost * BigInt(spentCount));
    });

    it('2. charging past the cap closes the gate for the NEXT caller', async () => {
      await setSpend(BUDGET_MICROS - 1n);

      await ledger.charge(tenant.organizationId, 1n, context());

      const decision = await ledger.checkBudget(
        tenant.organizationId,
        AiSurface.DRAFT,
        context(),
      );
      expect(decision.allowed).toBe(false);
    });

    it('3. never throws when Redis rejects — the money is already gone', async () => {
      // The deliberate asymmetry: the GATE fails closed, the CHARGE fails open.
      // By the time we are charging, the model has run and the money is spent —
      // refusing the caller their answer would lose the work as well.
      faults.fail(counter, 'charge', new Error('ECONNREFUSED'));

      await expect(
        ledger.charge(tenant.organizationId, 1_000n, context()),
      ).resolves.toBeUndefined();
    });

    it('4. ignores a zero or negative charge', async () => {
      await ledger.charge(tenant.organizationId, 0n, context());

      expect(
        await counter.spentMicros(tenant.organizationId, CYCLE_START),
      ).toBe(0n);
    });
  });

  // --------------------------------------------------------------- the record

  describe('record', () => {
    it('1. returns a generationId SYNCHRONOUSLY — §1.3 test 4', async () => {
      // Before the write completes, because the caller needs it in the response
      // body (`generatedFromId` closes the draft-acceptance loop) and awaiting a
      // durable write for an id we already know would put a Postgres round trip
      // on the streaming path.
      const id = ledger.record(entry());

      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      expect(await waitForRows(1)).toBe(true);
    });

    it('2. SWALLOWS a write failure and still returns an id — §1.3 test 4', async () => {
      faults.fail(
        fx.prisma.aiGeneration,
        'create',
        new Error('injected failure'),
      );

      const id = ledger.record(entry());
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      expect(await fx.prisma.aiGeneration.count()).toBe(0);
    });

    it('3. computes COST from the model and tokens, not tokens alone', async () => {
      // Money is what a budget protects. Cost per token varies by an order of
      // magnitude across tiers, so a token budget stops meaning anything the
      // moment model choice becomes sellable.
      ledger.record(entry({ modelName: GENERATION_MODEL_BY_TIER.QUALITY }));
      await waitForRows(1);

      const row = await fx.prisma.aiGeneration.findFirstOrThrow();
      expect(row.estimatedCostMicros).toBe(
        estimateCostMicros(GENERATION_MODEL_BY_TIER.QUALITY, 1000, 500),
      );
    });

    it('4. the SAME tokens cost different money on different models', async () => {
      ledger.record(entry({ modelName: GENERATION_MODEL_BY_TIER.FAST }));
      ledger.record(entry({ modelName: GENERATION_MODEL_BY_TIER.QUALITY }));
      await waitForRows(2);

      const rows = await fx.prisma.aiGeneration.findMany({
        orderBy: { estimatedCostMicros: 'asc' },
      });
      expect(rows[0].estimatedCostMicros).toBeLessThan(
        rows[1].estimatedCostMicros,
      );
    });

    it('5. records a FAILED call — it still consumed prompt tokens', async () => {
      // Recording only successes under-counts spend, and under-counting is the
      // direction that lets a tenant keep spending past their cap.
      ledger.record(
        entry({ status: AiGenerationStatus.FAILED, completionTokens: 0 }),
      );
      await waitForRows(1);

      const row = await fx.prisma.aiGeneration.findFirstOrThrow();
      expect(row.status).toBe(AiGenerationStatus.FAILED);
      expect(row.estimatedCostMicros).toBeGreaterThan(0n);
    });

    it('6. an unpriced model does not CRASH the recording path', async () => {
      // `record` is non-throwing by contract, so a missing pricing entry must
      // not escape — a caller whose request died because a pricing row was
      // absent would lose an answer that had already been paid for.
      //
      // The cost is zero here, which UNDER-COUNTS, and that is why the real
      // guard is a startup check rather than this branch: see
      // `assertPricingTableCovers` in `ai-pricing.config.spec.ts`. This test
      // only pins that the fallback is survivable, not that it is acceptable.
      expect(() =>
        ledger.record(entry({ modelName: 'some-unpriced-model' })),
      ).not.toThrow();
      await waitForRows(1);

      const row = await fx.prisma.aiGeneration.findFirstOrThrow();
      expect(row.estimatedCostMicros).toBe(0n);
    });

    it('7. carries the retrieved and cited chunk arrays', async () => {
      // `retrieved` empty is the knowledge-gap signal, and `cited` being a
      // strict subset is what makes UNCITED computable at all.
      const retrieved = [faker.string.uuid(), faker.string.uuid()];
      ledger.record(
        entry({ retrievedChunkIds: retrieved, citedChunkIds: [retrieved[0]] }),
      );
      await waitForRows(1);

      const row = await fx.prisma.aiGeneration.findFirstOrThrow();
      expect(row.retrievedChunkIds).toEqual(retrieved);
      expect(row.citedChunkIds).toEqual([retrieved[0]]);
    });

    it('8. leaves userId NULL for system work', async () => {
      ledger.record(
        entry({ userId: null, purpose: AiGenerationPurpose.EMBEDDING }),
      );
      await waitForRows(1);

      const row = await fx.prisma.aiGeneration.findFirstOrThrow();
      expect(row.userId).toBeNull();
    });
  });

  // ------------------------------------------------------- reconciliation

  describe('reconciliation', () => {
    it('1. counter and SUM diverge after a swallowed failure, and reconciliation converges — §1.3 test 3', async () => {
      // The ACTUAL invariant. Asserting the two always agree would directly
      // contradict `record()` swallowing failures: if it swallows, they WILL
      // diverge, and what must hold is that reconciliation restores agreement.
      await ledger.chargeAndRecord(entry(), context());
      await waitForRows(1);

      // Now a charge whose ledger write fails — the counter moves, the ledger
      // does not.
      // Restored by the injector's `afterEach` — but this test needs the write
      // working again BEFORE its own next assertion, so it is restored here as
      // well. `mockRestore()` twice is a no-op; not restoring at all would make
      // the reconciliation below write into a mock that always rejects.
      const create = faults.fail(
        fx.prisma.aiGeneration,
        'create',
        new Error('injected failure'),
      );
      await ledger.chargeAndRecord(entry(), context());
      await new Promise((resolve) => setTimeout(resolve, 100));
      create.mockRestore();

      const drifted = await counter.spentMicros(
        tenant.organizationId,
        CYCLE_START,
      );
      const trueSpend = await ledger.reconcile(
        tenant.organizationId,
        CYCLE_START,
      );

      // They disagreed...
      expect(drifted).toBeGreaterThan(trueSpend);
      // ...and now they do not.
      expect(
        await counter.spentMicros(tenant.organizationId, CYCLE_START),
      ).toBe(trueSpend);
    });

    it('2. SETS rather than increments, so drift is corrected not compounded', async () => {
      await setSpend(999_999n);
      await fx.prisma.aiGeneration.create({
        data: {
          organizationId: tenant.organizationId,
          purpose: AiGenerationPurpose.CHAT_ANSWER,
          modelName: GENERATION_MODEL_BY_TIER.FAST,
          estimatedCostMicros: 100n,
        },
      });

      await ledger.reconcile(tenant.organizationId, CYCLE_START);

      expect(
        await counter.spentMicros(tenant.organizationId, CYCLE_START),
      ).toBe(100n);
    });

    it('3. ignores rows from a PREVIOUS cycle', async () => {
      await fx.prisma.aiGeneration.create({
        data: {
          organizationId: tenant.organizationId,
          purpose: AiGenerationPurpose.CHAT_ANSWER,
          modelName: GENERATION_MODEL_BY_TIER.FAST,
          estimatedCostMicros: 500n,
          createdAt: new Date('2026-07-15T00:00:00.000Z'),
        },
      });

      expect(await ledger.reconcile(tenant.organizationId, CYCLE_START)).toBe(
        0n,
      );
    });
  });

  // ------------------------------------------------------ threshold alerts

  describe('threshold alerts', () => {
    const alertCommands = () =>
      natsEmit.mock.calls.filter(
        (call) => call[0] === IN_APP_NOTIFICATION_PATTERN,
      );

    it('1. fires ONCE per threshold per cycle — §1.3 test 7', async () => {
      // Publish twice, assert one notification. The durable guard is Domain E's
      // `UNIQUE (recipient_id, event_id)`; this one is the local guard that
      // makes the behaviour true today, while Domain E does not exist.
      await setSpend(790_000n);
      await ledger.charge(tenant.organizationId, 20_000n, context());
      await new Promise((resolve) => setTimeout(resolve, 100));
      await ledger.charge(tenant.organizationId, 10_000n, context());
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(alertCommands()).toHaveLength(1);
    });

    it('2. uses the derived event_id shape, never a uuid', async () => {
      // Derived is what makes redelivery harmless. A generated id would make
      // every retry a new notification, which is the alert-fatigue failure the
      // whole ladder is trying to avoid.
      await setSpend(790_000n);
      await ledger.charge(tenant.organizationId, 20_000n, context());
      await new Promise((resolve) => setTimeout(resolve, 100));

      const [, command] = alertCommands()[0] as [string, { eventId: string }];
      expect(command.eventId).toBe(
        quotaThresholdEventId(tenant.organizationId, CYCLE_START, 80),
      );
    });

    it('3. addresses organization.update holders, not the whole tenant', async () => {
      // An agent cannot buy more budget. Telling them is noise that trains
      // people to ignore the next alert.
      await setSpend(790_000n);
      await ledger.charge(tenant.organizationId, 20_000n, context());
      await new Promise((resolve) => setTimeout(resolve, 100));

      // The AUDIENCE UNION, not the old `audiencePermission`
      // field. This producer is the reason the `permission` kind exists: it
      // genuinely does not know who holds `organization.update` in a tenant, so
      // it names the permission and auth-service resolves it. A ticket event
      // would use the `users` kind instead.
      const [, command] = alertCommands()[0] as [
        string,
        { audience: { kind: string; permission: string }; type: string },
      ];
      expect(command.audience).toEqual({
        kind: 'permission',
        permission: 'organization.update',
      });
      // And the ORIGINATING event, never the transport subject — without this
      // a user could turn every notification off or none, and nothing between.
      expect(command.type).toBe('quota.threshold');
    });

    it('4. marks the 100% alert CRITICAL, the others NORMAL', async () => {
      // CRITICAL bypasses quiet hours and digest batching — an admin asleep
      // through the moment their queue triples is the case that exists for.
      await setSpend(940_000n);
      await ledger.charge(tenant.organizationId, 100_000n, context());
      await new Promise((resolve) => setTimeout(resolve, 150));

      const priorities = alertCommands().map(
        (call) => (call[1] as { priority: NotificationPriority }).priority,
      );
      expect(priorities).toContain(NotificationPriority.CRITICAL);
    });

    it('5. says what HAPPENS, not which percentage was crossed', async () => {
      // "You have used 80% of your AI budget" prompts nobody to act. What an
      // admin needs is that every deflected question becomes a ticket.
      await setSpend(790_000n);
      await ledger.charge(tenant.organizationId, 20_000n, context());
      await new Promise((resolve) => setTimeout(resolve, 100));

      const [, command] = alertCommands()[0] as [string, { body: string }];
      expect(command.body).toMatch(/route to your agents/i);
      expect(command.body).toMatch(/3-5x/i);
    });

    it('6. a cycle ROLL re-arms every alert', async () => {
      await setSpend(790_000n);
      await ledger.charge(tenant.organizationId, 20_000n, context());
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(alertCommands()).toHaveLength(1);

      // New cycle: new counter key, new event id, so the guard from the old
      // cycle cannot suppress the new alert.
      const nextCycle = new Date('2026-09-01T00:00:00.000Z');
      getAiEntitlement.mockResolvedValue({
        budgetMicros: BUDGET_MICROS,
        billingCycleStart: nextCycle,
      });
      await redis.set(
        quotaCounterKey(tenant.organizationId, nextCycle),
        '790000',
      );
      await ledger.charge(tenant.organizationId, 20_000n, context());
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(alertCommands()).toHaveLength(2);
    });

    it('7. does NOT fire below the first threshold', async () => {
      await ledger.charge(tenant.organizationId, 100_000n, context());
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(alertCommands()).toHaveLength(0);
    });
  });

  // -------------------------------------------------- the shared key format

  describe('the quota key', () => {
    it('1. is built from the org and the CYCLE START in seconds — §1.3 test 9', () => {
      // The format is duplicated in Python, because every service that spends
      // increments this counter directly rather than over gRPC. Seconds and not
      // milliseconds is the single most likely way the two implementations
      // silently disagree: Python's `datetime.timestamp()` yields seconds,
      // JavaScript's `getTime()` yields milliseconds.
      expect(quotaCounterKey('org-1', CYCLE_START)).toBe(
        `quota:org-1:${Math.floor(CYCLE_START.getTime() / 1000)}`,
      );
      expect(quotaCounterKey('org-1', CYCLE_START)).toBe(
        'quota:org-1:1785542400',
      );
    });

    it('2. is what the counter actually writes', async () => {
      // Asserting the helper alone would not catch a service that built the key
      // by hand somewhere.
      await ledger.charge(tenant.organizationId, 1234n, context());

      const raw = await redis.get(
        quotaCounterKey(tenant.organizationId, CYCLE_START),
      );
      expect(raw).toBe('1234');
    });
  });
});

describe('§4.2 The acceptance loop (e2e)', () => {
  let fx: E2eFixture;
  let ledger: AiLedgerService;
  let tenant: TenantFixture;

  const MESSAGE_ID = '55555555-5555-4555-8555-555555555555';

  const draft = async (content: string) => {
    return fx.prisma.aiGeneration.create({
      data: {
        organizationId: tenant.organizationId,
        purpose: AiGenerationPurpose.DRAFT,
        modelName: GENERATION_MODEL_BY_TIER.FAST,
        promptTokens: 500,
        completionTokens: 100,
        estimatedCostMicros: 90n,
        content,
      },
    });
  };

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    ledger = fx.moduleRef.get(AiLedgerService);
  });

  beforeEach(async () => {
    await fx.reset();
    tenant = buildTenant();
  });

  afterAll(async () => {
    await fx.close();
  });

  it('1. Posting a draft VERBATIM records ACCEPTED and the resulting message', async () => {
    const row = await draft('The expense limit is 500 per claim.');

    await expect(
      ledger.recordOutcome(
        row.id,
        MESSAGE_ID,
        'The expense limit is 500 per claim.',
      ),
    ).resolves.toBe(AiGenerationOutcome.ACCEPTED);

    const updated = await fx.prisma.aiGeneration.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(updated.outcome).toBe(AiGenerationOutcome.ACCEPTED);
    expect(updated.resultingMessageId).toBe(MESSAGE_ID);
  });

  it('2. A TRAILING-NEWLINE-only difference is ACCEPTED, not EDITED', async () => {
    // The one that keeps the metric honest. A rich-text editor adds a newline
    // on send, and exact equality would report every untouched draft as
    // EDITED — understating the number that justifies the whole feature.
    const row = await draft('The expense limit is 500 per claim.');

    await expect(
      ledger.recordOutcome(
        row.id,
        MESSAGE_ID,
        'The expense limit is 500 per claim.\n',
      ),
    ).resolves.toBe(AiGenerationOutcome.ACCEPTED);
  });

  it('3. A real edit records EDITED', async () => {
    const row = await draft('The expense limit is 500 per claim.');

    await expect(
      ledger.recordOutcome(
        row.id,
        MESSAGE_ID,
        'The expense limit is 750 per claim.',
      ),
    ).resolves.toBe(AiGenerationOutcome.EDITED);
  });

  it('4. An unknown generation id is NOT_FOUND, never a silent no-op', async () => {
    // The caller is about to tell a user their reply was sent. A quietly
    // dropped outcome makes acceptance rate wrong in a way nobody can
    // reconstruct.
    await expect(
      ledger.recordOutcome(
        '66666666-6666-4666-8666-666666666666',
        MESSAGE_ID,
        'anything',
      ),
    ).rejects.toBeInstanceOf(RpcException);
  });
});
