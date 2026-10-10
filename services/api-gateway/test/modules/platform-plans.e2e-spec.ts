import { of, throwError } from 'rxjs';
import { AiModelTier as ProtoAiModelTier } from '@synapsedesk/grpc-proto';
import {
  API,
  E2eFixture,
  authenticatedAgent,
  bootstrapE2eTest,
} from '../utils';
import { timestamp } from '../fixtures/wire';

/**
 * `/platform/plans` — the DTO layer, which is the only place these bugs live.
 *
 * **Every test here asserts on what the gateway SENT, not on what it answered.**
 * The failures this file exists for are silent at the edge: a DTO default is a
 * valid request producing a valid response, and the damage is a field the caller
 * never mentioned arriving at the service as if they had. The service-level
 * suite cannot see any of it — it hands `updatePlan` a proto request built by
 * hand and never runs the mapper where a default would apply.
 */
describe('Platform plans (e2e)', () => {
  let fx: E2eFixture;

  const superAdmin = () =>
    authenticatedAgent(fx.app, { isSuperAdmin: true, organizationId: null });

  const planId = '11111111-2222-4333-8444-555555555555';

  const wirePlan = () => ({
    id: planId,
    name: 'Professional',
    stripeProductId: 'prod_test',
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
    subscriberCount: 3,
    createdAt: timestamp(new Date()),
    updatedAt: timestamp(new Date()),
    deletedAt: undefined,
  });

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    fx.stubs.platform.updatePlan.mockReturnValue(of(wirePlan()));
    fx.stubs.platform.createPlan.mockReturnValue(of(wirePlan()));
    // The apply path composes ingestion's usage, so the leg has to answer or
    // every projection test measures a degraded run instead of a healthy one.
    fx.stubs.ingestionPlatform.getPlatformUsage.mockReturnValue(
      of({ usage: [] }),
    );
  });

  afterAll(() => fx.close());

  it('1. **A PATCH naming only `name` sends NOTHING else over the wire**', async () => {
    // The `UpdatePlanDto` default trap, caught at the only layer that can see
    // it. Every field on that message is `optional` in the proto, so a default
    // on any of them turns "edit the name" into "also rewrite the seat count"
    // — and the next apply propagates that to every subscriber. The request is
    // valid, the response is correct, and nobody finds out until a tenant's
    // limit changes for no reason.
    await superAdmin()
      .patch(`${API}/platform/plans/${planId}`)
      .send({ name: 'Renamed' })
      .expect(200);

    expect(fx.stubs.platform.updatePlan).toHaveBeenCalledTimes(1);
    const [sent] = fx.stubs.platform.updatePlan.mock.calls[0];

    expect(sent.name).toBe('Renamed');
    expect(sent.planId).toBe(planId);

    // Every grant absent — asserted field by field rather than as a shape,
    // because a default would make one of them a number and `toMatchObject`
    // would not care.
    expect(sent.maxAgentSeats).toBeUndefined();
    expect(sent.maxStorageBytes).toBeUndefined();
    expect(sent.monthlyAiTokenBudget).toBeUndefined();
    expect(sent.aiModelTier).toBeUndefined();
    expect(sent.maxDocumentBytes).toBeUndefined();
    expect(sent.maxAttachmentBytes).toBeUndefined();
    expect(sent.isActive).toBeUndefined();
    expect(sent.stripeProductId).toBeUndefined();

    // **`false`, not `undefined`** — and this is the one field on the message
    // where the absent case is resolved at the MAPPER rather than the DTO. A
    // default on the DTO would clear the product id on every PATCH that never
    // mentioned it; leaving it `undefined` would lean on proto3 decoding an
    // absent `bool` as `false`, which is true today and is not a decision this
    // layer should be delegating.
    expect(sent.clearStripeProductId).toBe(false);
  });

  it('1b. …and a PATCH that DOES name a grant still sends it', async () => {
    // The complement. Test 1 alone passes for a mapper that drops every field
    // on the floor, which would be a worse bug wearing the same green.
    await superAdmin()
      .patch(`${API}/platform/plans/${planId}`)
      .send({ maxAgentSeats: 42 })
      .expect(200);

    const [sent] = fx.stubs.platform.updatePlan.mock.calls[0];

    expect(sent.maxAgentSeats).toBe(42);
    expect(sent.name).toBeUndefined();
  });

  it('3. **`prices` omitted on create arrives as `[]`, never `undefined`**', async () => {
    // `development-conventions.md` §5.2's clearest case: a `repeated` field
    // cannot express absent-versus-
    // empty on the wire at all, so the `?` bought nothing and cost every layer
    // below it a branch. A plan created with no prices is the assigned-only
    // plan — a legitimate row, not a missing one.
    await superAdmin()
      .post(`${API}/platform/plans`)
      .send({
        name: 'Assigned only',
        maxAgentSeats: 10,
        maxStorageBytes: 1024,
        monthlyAiTokenBudget: 1000,
        aiModelTier: 'FAST',
        maxDocumentBytes: 1024,
        maxAttachmentBytes: 1024,
        maxDocumentUploads: 100,
        maxAnalyticsRangeDays: 30,
      })
      .expect(201);

    const [sent] = fx.stubs.platform.createPlan.mock.calls[0];

    expect(sent.prices).toEqual([]);
    expect(sent.prices).not.toBeUndefined();
    // `isActive` defaults the same way, and to TRUE: a plan created without the
    // flag is one somebody intends to sell.
    expect(sent.isActive).toBe(true);
  });

  it('3b. A create that STATES `isActive: false` is not overridden by the default', async () => {
    await superAdmin()
      .post(`${API}/platform/plans`)
      .send({
        name: 'Draft',
        maxAgentSeats: 10,
        maxStorageBytes: 1024,
        monthlyAiTokenBudget: 1000,
        aiModelTier: 'FAST',
        maxDocumentBytes: 1024,
        maxAttachmentBytes: 1024,
        maxDocumentUploads: 100,
        maxAnalyticsRangeDays: 30,
        isActive: false,
      })
      .expect(201);

    expect(fx.stubs.platform.createPlan.mock.calls[0][0].isActive).toBe(false);
  });

  it('**A grant above its PLATFORM ceiling is refused at the edge**', async () => {
    // `MAX_DOCUMENT_BYTES` is not sellable. Refused rather than clamped, so a
    // catalogue row that tries to sell past the parser's limit is a 400 with a
    // named field instead of a silently smaller number nobody notices.
    await superAdmin()
      .post(`${API}/platform/plans`)
      .send({
        name: 'Too generous',
        maxAgentSeats: 10,
        maxStorageBytes: 1024,
        monthlyAiTokenBudget: 1000,
        aiModelTier: 'FAST',
        maxDocumentBytes: 500 * 1024 * 1024,
        maxAttachmentBytes: 1024,
        maxDocumentUploads: 100,
        maxAnalyticsRangeDays: 30,
      })
      .expect(400);

    expect(fx.stubs.platform.createPlan).not.toHaveBeenCalled();
  });

  it('**A Stripe price id with a space is refused; a real one is not**', async () => {
    // Character class, not a `price_` prefix: Stripe's id format is a
    // convention, and a well-formed id that does not exist fails on the next
    // API call exactly as a malformed one does. What this refuses is a paste
    // accident being carried into that call.
    const body = (stripePriceId: string) => ({
      name: 'Priced',
      maxAgentSeats: 10,
      maxStorageBytes: 1024,
      monthlyAiTokenBudget: 1000,
      aiModelTier: 'FAST',
      maxDocumentBytes: 1024,
      maxAttachmentBytes: 1024,
      maxDocumentUploads: 100,
      maxAnalyticsRangeDays: 30,
      prices: [{ stripePriceId, interval: 'month' }],
    });

    await superAdmin()
      .post(`${API}/platform/plans`)
      .send(body('price_1Ox with a space'))
      .expect(400);

    await superAdmin()
      .post(`${API}/platform/plans`)
      .send(body('price_1U8hblFSgux2NMTmm7aN5ZR6'))
      .expect(201);
  });

  describe('The composed projection', () => {
    const org = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

    /**
     * Keyed on `after` — the NUMERIC map the composer reads.
     *
     * `changes` is derived here rather than passed, because it is a display
     * string the gateway no longer parses (known-gaps #21). Deriving it keeps
     * every payload realistic and non-empty without inviting a test to assert
     * against a format nothing reads.
     */
    const wireProjection = (after: Record<string, number>) => ({
      subscribers: [
        {
          organizationId: org,
          organizationName: 'Acme',
          changes: Object.fromEntries(
            Object.entries(after).map(([field, value]) => [
              field,
              `${value * 2} -> ${value}`,
            ]),
          ),
          after,
          overLimit: [],
          skippedPinned: false,
          budgetDeferred: false,
        },
      ],
      dryRun: true,
      changedCount: 1,
      skippedPinnedCount: 0,
      overLimitCount: 0,
      // What AUTH evaluated. The gateway unions its own coverage into this
      // rather than replacing it: two honest sources, neither overwriting.
      evaluatedDimensions: ['seats'],
    });

    it('3. **`evaluatedDimensions` lists all three once ingestion answers**', async () => {
      fx.stubs.platform.applyPlan.mockReturnValue(
        of(wireProjection({ maxStorageBytes: 500 })),
      );
      fx.stubs.ingestionPlatform.getPlatformUsage.mockReturnValue(
        of({
          usage: [{ organizationId: org, usedBytes: 900, documentCount: 3 }],
        }),
      );

      const response = await superAdmin()
        .post(`${API}/platform/plans/${planId}/apply?dryRun=true`)
        .expect(200);

      expect(response.body.data.evaluatedDimensions).toEqual(
        expect.arrayContaining(['seats', 'storage', 'documents']),
      );
      // 900 bytes held against a plan dropping to 500.
      expect(response.body.data.overLimitCount).toBe(1);
      expect(response.body.data.subscribers[0].overLimit[0]).toMatch(
        /maxStorageBytes/,
      );
    });

    it('3b. **A DEAD ingestion leg drops its dimensions instead of reporting zero**', async () => {
      // The reason this field is dynamic rather than a constant. During an
      // ingestion outage a dry run can still answer seats — and must not answer
      // "nobody affected" for two dimensions nothing looked at.
      fx.stubs.platform.applyPlan.mockReturnValue(
        of(wireProjection({ maxStorageBytes: 500 })),
      );
      fx.stubs.ingestionPlatform.getPlatformUsage.mockReturnValue(
        throwError(() => new Error('ingestion-service is down')),
      );

      const response = await superAdmin()
        .post(`${API}/platform/plans/${planId}/apply?dryRun=true`)
        .expect(200);

      expect(response.body.data.evaluatedDimensions).toEqual(['seats']);
      expect(response.body.data.evaluatedDimensions).not.toContain('storage');
      // Still answered, rather than failing the whole dry run.
      expect(response.body.data.subscribers).toHaveLength(1);
    });

    it('3c. **The APPLY is composed too, and matches its dry run exactly**', async () => {
      // The dry-run-equals-apply guarantee, re-asserted at the layer that now
      // composes. The auth-level test cannot see this: enriching only the dry
      // run would put the divergence above it, with a green suite underneath.
      const projection = wireProjection({ maxDocumentUploads: 2 });
      fx.stubs.platform.applyPlan.mockReturnValue(of(projection));
      fx.stubs.ingestionPlatform.getPlatformUsage.mockReturnValue(
        of({
          usage: [{ organizationId: org, usedBytes: 1, documentCount: 5 }],
        }),
      );

      const dry = await superAdmin()
        .post(`${API}/platform/plans/${planId}/apply?dryRun=true`)
        .expect(200);
      const applied = await superAdmin()
        .post(`${API}/platform/plans/${planId}/apply`)
        .expect(200);

      expect(applied.body.data.subscribers).toEqual(dry.body.data.subscribers);
      expect(applied.body.data.evaluatedDimensions).toEqual(
        dry.body.data.evaluatedDimensions,
      );
      expect(dry.body.data.subscribers[0].overLimit[0]).toMatch(
        /maxDocumentUploads: 5 held/,
      );
    });

    it('3d. A PINNED subscriber is never reported over a limit it is not getting', async () => {
      // Nothing is being written for them, so there is nothing to be over —
      // and an overrun here would send an operator to a limit this apply does
      // not touch.
      //
      // **The `after` map is deliberately NON-empty**, which auth does not
      // produce for a pinned tenant today. An empty one would make this test
      // pass on `afterValue` returning null for every column, exercising
      // nothing — the guard under test is `skippedPinned`, and it only matters
      // if auth ever starts reporting what a pinned subscriber WOULD have got.
      const projection = wireProjection({
        maxStorageBytes: 1,
        maxDocumentUploads: 1,
      });
      projection.subscribers[0].skippedPinned = true;
      fx.stubs.platform.applyPlan.mockReturnValue(of(projection));
      fx.stubs.ingestionPlatform.getPlatformUsage.mockReturnValue(
        of({
          usage: [
            { organizationId: org, usedBytes: 10 ** 9, documentCount: 10 ** 6 },
          ],
        }),
      );

      const response = await superAdmin()
        .post(`${API}/platform/plans/${planId}/apply?dryRun=true`)
        .expect(200);

      expect(response.body.data.subscribers[0].overLimit).toEqual([]);
      expect(response.body.data.overLimitCount).toBe(0);
    });

    it('3e. An UNCHANGED limit produces no overrun, however much is used', async () => {
      // The projection is about the NEW plan. A column this apply does not move
      // is ABSENT from `after`, and treating a missing key as a limit of zero
      // would put every tenant over every dimension.
      fx.stubs.platform.applyPlan.mockReturnValue(
        of(wireProjection({ maxAgentSeats: 20 })),
      );
      fx.stubs.ingestionPlatform.getPlatformUsage.mockReturnValue(
        of({
          usage: [
            { organizationId: org, usedBytes: 10 ** 9, documentCount: 10 ** 6 },
          ],
        }),
      );

      const response = await superAdmin()
        .post(`${API}/platform/plans/${planId}/apply?dryRun=true`)
        .expect(200);

      expect(response.body.data.subscribers[0].overLimit).toEqual([]);
    });
  });
});
