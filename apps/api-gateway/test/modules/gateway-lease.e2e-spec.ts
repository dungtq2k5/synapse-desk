import Redis from 'ioredis';
import request from 'supertest';
import {
  ACCESS_COOKIE,
  E2eFixture,
  RealtimeFixture,
  bootstrapE2eTest,
  bootstrapRealtimeTest,
  buildJwtPayload,
  flushTestRedis,
  signAccessToken,
} from '../utils';
import {
  GatewayLeaseService,
  holdersKey,
  LEASE_TTL_MS,
  type LeaseRuntime,
} from '../../src/common/lease/gateway-lease.service';
import type { RedisService } from '../../src/common/redis/redis.service';

/**
 * The implementation lease, against a REAL Redis.
 *
 * **The exclusion is between IMPLEMENTATIONS, not between processes**, and
 * those are opposite answers for the same question — "may I serve?" — so a
 * suite that only proved mutual exclusion would prove the wrong thing. Two
 * Node replicas must BOTH serve (production runs `replicas: 2`); a Java pod
 * holding the key must keep every Node pod standing by. Both rows are here
 * because the claim script decides both, in one branch each.
 *
 * Java does not exist yet, so the foreign holder is a member written straight
 * into `gateway:holders:java` — which is all a Java pod would write, and
 * writing it by hand is what makes the row runnable today rather than after
 * the JVM lands.
 *
 * The service is driven by `bind()`, the real entry point, not by calling the
 * private beat: what is under test includes the order — claim, then activate —
 * and a test that called `claim` itself would not see it.
 */
describe('The gateway implementation lease (e2e)', () => {
  let redis: Redis;
  let service: RedisService;
  const leases: GatewayLeaseService[] = [];

  /** Records what the runtime was told to do, in order. */
  const recorder = () => {
    const events: string[] = [];

    return {
      events,
      runtime: {
        activate: () => {
          events.push('activate');

          return Promise.resolve();
        },
        deactivate: () => {
          events.push('deactivate');

          return Promise.resolve();
        },
      } satisfies LeaseRuntime,
    };
  };

  const bind = async (runtime: LeaseRuntime) => {
    const lease = new GatewayLeaseService(service);
    leases.push(lease);
    await lease.bind(runtime);

    return lease;
  };

  beforeAll(() => {
    redis = new Redis(process.env.REDIS_URL as string, {
      maxRetriesPerRequest: 1,
    });
    // Only `client` is reached; the connection's lifecycle belongs to this
    // suite rather than to a Nest container it would otherwise have to boot.
    service = { client: redis } as RedisService;
  });

  beforeEach(async () => {
    await flushTestRedis();
  });

  afterEach(async () => {
    while (leases.length) await leases.pop()?.onApplicationShutdown();
  });

  afterAll(() => {
    redis.disconnect();
  });

  it('**two Node replicas BOTH serve** — the lease excludes implementations, not processes', async () => {
    const first = recorder();
    const second = recorder();

    await bind(first.runtime);
    await bind(second.runtime);

    expect([first.events, second.events]).toEqual([['activate'], ['activate']]);
    expect(leases.every((lease) => lease.isActive())).toBe(true);

    // One entry per POD, not one key per implementation: a shared key would be
    // deleted by whichever replica exited first, handing over while the other
    // was still consuming.
    expect(await redis.zcard(holdersKey('node'))).toBe(2);
  });

  it("**a foreign implementation's entry keeps Node a standby**", async () => {
    // What a Java pod writes, written by hand until Java exists.
    await redis.zadd(
      holdersKey('java'),
      Date.now() + LEASE_TTL_MS,
      'java-pod-1:7:abcdef12',
    );

    const node = recorder();
    const lease = await bind(node.runtime);

    expect(lease.isActive()).toBe(false);
    // Never started, rather than started and stopped: a standby that briefly
    // consumed would have relayed frames the other implementation also relayed.
    expect(node.events).toEqual([]);
    expect(await redis.zcard(holdersKey('node'))).toBe(0);
  });

  it('an EXPIRED foreign entry does not keep Node standing by', async () => {
    // The pruning half of the same script. Without it a Java pod that was
    // SIGKILLed — no shutdown hook, so no `ZREM` — would hold the gateway down
    // until something else removed its entry.
    await redis.zadd(holdersKey('java'), Date.now() - 1, 'java-pod-gone:7:00');

    const node = recorder();
    const lease = await bind(node.runtime);

    expect(lease.isActive()).toBe(true);
    expect(node.events).toEqual(['activate']);
    expect(await redis.zcard(holdersKey('java'))).toBe(0);
  });

  it('**shutdown releases the entry**, so the other implementation may claim at once', async () => {
    const node = recorder();
    const lease = await bind(node.runtime);
    expect(await redis.zcard(holdersKey('node'))).toBe(1);

    await leases.pop()?.onApplicationShutdown();

    // Stopped consuming AND gave the entry back — the entry last, so the
    // handover window is bounded by this process having already stopped rather
    // than by the TTL.
    expect(node.events).toEqual(['activate', 'deactivate']);
    expect(lease.isActive()).toBe(false);
    expect(await redis.zcard(holdersKey('node'))).toBe(0);
  });

  it('**a holder whose entry was deleted underneath it steps down** on the next beat', async () => {
    const node = recorder();
    const lease = await bind(node.runtime);

    // What a pause past the TTL looks like from Redis's side: the entry is
    // gone and another implementation may already have claimed. The refresh is
    // compare-and-extend for exactly this — a plain `ZADD` would put this
    // process back beside the new owner, two active gateways, which is the one
    // outcome the lease exists to prevent.
    await redis.del(holdersKey('node'));
    await lease.beat();

    expect(lease.isActive()).toBe(false);
    expect(node.events).toEqual(['activate', 'deactivate']);
  });

  it('a beat while still holding the entry EXTENDS it rather than re-adding it', async () => {
    const node = recorder();
    const lease = await bind(node.runtime);
    const [before] = await redis.zrange(holdersKey('node'), '0', '-1');

    await lease.beat();

    const after = await redis.zrange(holdersKey('node'), '0', '-1');
    expect(after).toEqual([before]);
    expect(
      Number(await redis.zscore(holdersKey('node'), before)),
    ).toBeGreaterThan(Date.now());
    expect(lease.isActive()).toBe(true);
    // Still one entry, and still serving: a beat is not a re-claim.
    expect(node.events).toEqual(['activate']);
  });
});

/**
 * What a STANDBY does, through the two surfaces that decide whether traffic
 * reaches this process.
 *
 * The suite above proves who holds the lease; this one proves what the answer
 * changes. They are separate because these two need a booted app and that one
 * needs a real Redis, and a fixture on the real lease steps down when
 * `flushTestRedis` removes its entry — see `leaseSwitch`.
 */
describe('A standby gateway (e2e)', () => {
  const ORG = '33333333-3333-4333-8333-333333333333';

  let fx: E2eFixture;
  let realtime: RealtimeFixture;

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    realtime = await bootstrapRealtimeTest();
  }, 60_000);

  afterAll(async () => {
    await realtime.close();
    await fx.close();
  });

  afterEach(() => {
    fx.lease.setActive(true);
    realtime.lease.setActive(true);
  });

  it('**`/health/ready` answers 503 while standing by**, and 200 once it serves', async () => {
    const server = fx.app.getHttpServer();

    const serving = await request(server).get('/health/ready');
    expect(serving.status).toBe(200);

    fx.lease.setActive(false);
    const standby = await request(server).get('/health/ready');

    expect(standby.status).toBe(503);
    // The SHAPE does not change — `ready` is the field that already said
    // whether to route here, so no client and no OpenAPI response moves.
    expect(standby.body).toMatchObject({
      data: { ready: false, draining: false, dependencies: { redis: 'UP' } },
    });
  });

  it('**`/health` stays 200 while standing by** — the kubelet must not restart it', async () => {
    fx.lease.setActive(false);

    // The whole point of a standby over a refusal: it is booted and warm, so
    // the switch costs a poll rather than a cold start. A liveness probe that
    // failed here would restart the pod on a loop and there would be nothing
    // warm to switch to.
    const response = await request(fx.app.getHttpServer()).get('/health');

    expect(response.status).toBe(200);
  });

  it('**a standby accepts no socket**, even from a caller whose cookie is valid', async () => {
    // Valid on purpose: the refusal has to be about the lease, not about
    // authentication. The same shape the no-cookie row uses — a socket is
    // refused by connecting and then being disconnected, which is what a
    // browser client sees.
    const accepted = await realtime.connectClient({ organizationId: ORG });
    expect(accepted.connected).toBe(true);

    realtime.lease.setActive(false);
    const refused = realtime.connectRaw(
      `${ACCESS_COOKIE}=${signAccessToken(buildJwtPayload({ organizationId: ORG }))}`,
    );

    await expect(
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('still open')), 3_000);
        refused.on('disconnect', () => {
          clearTimeout(timer);
          resolve();
        });
        refused.on('connect_error', () => {
          clearTimeout(timer);
          resolve();
        });
      }),
    ).resolves.toBeUndefined();
  });
});
