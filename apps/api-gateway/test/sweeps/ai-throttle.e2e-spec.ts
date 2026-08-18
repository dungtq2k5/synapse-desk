import { of } from 'rxjs';
import { OrgStatus } from '@synapsedesk/common';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import {
  API,
  E2eFixture,
  authenticatedAgent,
  bootstrapE2eTest,
  flushTestRedis,
} from '../utils';
import { ROUTE_THROTTLE } from '../../src/common/config/throttler.config';

/**
 * Every AI route carries an explicit limit, and it FIRES.
 *
 * **The assertion is a 429, not the presence of a decorator.** The first attempt
 * at this fix overrode `authTier`, which `SmartThrottlerGuard` skips on any
 * route not marked `@AuthThrottle()` — the decorator was there, the policy read
 * correctly in one place, and the limit was never evaluated. A test that
 * inspected metadata would have passed against that.
 *
 * Why the monthly quota does not make this redundant: the quota is a MONTH
 * budget checked per request. Nothing in it stops one user spending the whole
 * month in ten minutes, and when they do, every symptom points at a cap working
 * exactly as designed.
 */
describe('AI route rate limiting (e2e)', () => {
  let fx: E2eFixture;

  const TICKET_ID = '44444444-4444-4444-8444-444444444444';

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
  });

  beforeEach(async () => {
    await flushTestRedis();
    jest.clearAllMocks();

    fx.stubs.organization.getOrganizationStatus.mockReturnValue(
      of({ status: toProtoOrgStatus(OrgStatus.ACTIVE), deleted: false }),
    );
  });

  afterAll(async () => {
    await fx.close();
  });

  /**
   * Fires `limit + 1` requests and returns the last status.
   *
   * One caller, one route — which is what a throttle is measured in. The
   * tracker keys authenticated callers on `user:{sub}`, so a shared agent is
   * a shared bucket by construction.
   */
  async function exhaust(
    route: { method: 'post' | 'get'; path: string; body?: object },
    limit: number,
    permissionCodes: string[],
  ): Promise<number[]> {
    const agent = authenticatedAgent(fx.app, {
      sub: '55555555-5555-4555-8555-555555555555',
      permissionCodes: permissionCodes as never,
    });

    const statuses: number[] = [];

    for (let attempt = 0; attempt <= limit; attempt += 1) {
      const request = agent[route.method](`${API}${route.path}`);
      const response = await (route.body
        ? request.send(route.body)
        : request.send());

      statuses.push(response.status);
    }

    return statuses;
  }

  const CASES = [
    {
      name: 'POST /tickets/:id/ai/draft',
      route: {
        method: 'post' as const,
        path: `/tickets/${TICKET_ID}/ai/draft`,
        body: {},
      },
      limit: ROUTE_THROTTLE.aiDraft.limit,
      permissions: ['ticket.ai.use'],
      stub: (fixture: E2eFixture) =>
        fixture.stubs.ai.generateDraft.mockReturnValue(
          of({
            content: 'draft',
            modelName: '',
            promptTokens: 0,
            completionTokens: 0,
            generationId: 'gen-1',
            citations: [],
          }),
        ),
    },
    {
      name: 'POST /tickets/:id/ai/suggestions',
      route: {
        method: 'post' as const,
        path: `/tickets/${TICKET_ID}/ai/suggestions`,
      },
      limit: ROUTE_THROTTLE.aiSuggestions.limit,
      permissions: ['ticket.ai.use'],
      stub: (fixture: E2eFixture) =>
        fixture.stubs.ai.getSuggestions.mockReturnValue(
          of({ items: [], articles: [] }),
        ),
    },
    {
      name: 'POST /tickets/:id/ai/summary',
      route: {
        method: 'post' as const,
        path: `/tickets/${TICKET_ID}/ai/summary`,
      },
      limit: ROUTE_THROTTLE.aiSummary.limit,
      permissions: ['ticket.ai.use'],
      stub: (fixture: E2eFixture) =>
        fixture.stubs.ai.generateSummary.mockReturnValue(
          of({
            id: 'sum-1',
            ticketId: TICKET_ID,
            summaryText: 's',
            suggestedAction: 'a',
            confidenceScore: 1,
            modelName: 'm',
            createdAt: { seconds: 1_756_684_800, nanos: 0 },
            updatedAt: { seconds: 1_756_684_800, nanos: 0 },
          }),
        ),
    },
    {
      name: 'POST /knowledge/search',
      route: {
        method: 'post' as const,
        path: '/knowledge/search',
        body: { query: 'anything' },
      },
      limit: ROUTE_THROTTLE.knowledgeSearch.limit,
      permissions: [],
      stub: (fixture: E2eFixture) =>
        fixture.stubs.rag.search.mockReturnValue(
          of({ chunks: [], degraded: 0 }),
        ),
    },
  ];

  it.each(CASES)(
    'Answers 429 once $name exceeds its limit',
    async ({ route, limit, permissions, stub }) => {
      stub(fx);

      const statuses = await exhaust(route, limit, permissions);

      // Everything up to the limit is allowed…
      expect(statuses.slice(0, limit).every((code) => code < 400)).toBe(true);
      // …and the one past it is refused.
      expect(statuses[limit]).toBe(429);
    },
  );

  it('Keys the limit per USER, not per IP', async () => {
    // Ten agents behind one office NAT sharing a per-IP limit is a support
    // ticket — and a per-IP limit on an authenticated route is barely a limit
    // anyway. `getTracker()` returns `user:{sub}` when there is a caller.
    fx.stubs.rag.search.mockReturnValue(of({ chunks: [], degraded: 0 }));

    const limit = ROUTE_THROTTLE.knowledgeSearch.limit;

    const first = authenticatedAgent(fx.app, {
      sub: '66666666-6666-4666-8666-666666666666',
    });
    for (let attempt = 0; attempt < limit + 1; attempt += 1) {
      await first.post(`${API}/knowledge/search`).send({ query: 'q' });
    }

    // A DIFFERENT user, same process and same IP, is unaffected.
    const second = authenticatedAgent(fx.app, {
      sub: '77777777-7777-4777-8777-777777777777',
    });
    const response = await second
      .post(`${API}/knowledge/search`)
      .send({ query: 'q' });

    expect(response.status).not.toBe(429);
  });

  it('Leaves a non-AI route on the general backstop', async () => {
    // The AI limits are an OVERRIDE of one general tier, not a new policy for
    // everything. A change that tightened every authenticated route would show
    // up here rather than in production.
    fx.stubs.organization.getOrganizationUsage.mockReturnValue(
      of({
        seats: { available: true, used: 1, limit: 10 },
        storage: { available: false, unavailableReason: 'n/a' },
        aiTokens: { available: false, unavailableReason: 'n/a' },
        billingCycleStart: { seconds: 1_756_684_800, nanos: 0 },
        aiModelTier: 1,
        planName: 'Free',
      }),
    );

    const agent = authenticatedAgent(fx.app, {
      permissionCodes: ['organization.read'],
    });

    const statuses: number[] = [];
    for (
      let attempt = 0;
      attempt < ROUTE_THROTTLE.knowledgeSearch.limit + 5;
      attempt += 1
    ) {
      const response = await agent.get(`${API}/organizations/current/usage`);
      statuses.push(response.status);
    }

    expect(statuses.every((code) => code !== 429)).toBe(true);
  });
});
