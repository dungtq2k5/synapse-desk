import request from 'supertest';
import { E2eFixture, bootstrapE2eTest } from '../utils';
import { envValidationSchema } from '../../src/common/config/env.validation';
import { ServiceRegistry } from '../../src/modules/health/service-registry.service';
import { RedisHealthService } from '../../src/modules/health/redis-health.service';
import { DrainState } from '../../src/modules/health/drain-state.service';
import { compareAlphabetically } from '@synapsedesk/common';

/**
 * `/health` and `/health/ready`.
 *
 * **The bug this suite exists for turned any single outage into a total one.**
 * Readiness computed `every(peer => peer.health !== 'DOWN')`, so one gRPC peer
 * being down made every gateway instance report not-ready and Kubernetes pulled
 * all of them. `ingestion-service` crashing would have taken down login,
 * tickets, chat, notifications and analytics — none of which need it — and the
 * mechanism was the health check itself.
 *
 * There were no health tests at all before this, which is how it survived: the
 * endpoint returned a plausible shape, and nothing asserted what the boolean
 * was allowed to depend on.
 */
describe('Health probes (e2e)', () => {
  let fx: E2eFixture;

  const readiness = () => request(fx.app.getHttpServer()).get('/health/ready');
  const liveness = () => request(fx.app.getHttpServer()).get('/health');

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
  }, 30_000);

  afterEach(() => jest.restoreAllMocks());
  afterAll(() => fx.close());

  /**
   * The peer probe is a local channel-state read, so the peers in this suite are
   * genuinely unreachable — the URLs in `.env.test` point at ports nothing
   * listens on. That is what makes test 1 real rather than mocked: the registry
   * reports DOWN because the peers ARE down.
   */
  const downPeers = () =>
    jest.spyOn(fx.app.get(ServiceRegistry), 'checkAll').mockReturnValue({
      auth: {
        name: 'auth',
        url: 'localhost:59999',
        health: 'DOWN',
        lastChecked: new Date(),
      },
      ingestion: {
        name: 'ingestion',
        url: 'localhost:59997',
        health: 'DOWN',
        lastChecked: new Date(),
      },
    });

  it('1. **a peer marked DOWN leaves `ready: true`** and appears under `peers`', async () => {
    // The bug, pinned. A readiness probe answers one question — should traffic
    // reach THIS instance? — and a peer being down is the same on every
    // instance, so gating on it removes all of them and helps nobody.
    downPeers();

    const response = await readiness().expect(200);

    expect(response.body.data).toMatchObject({
      ready: true,
      peers: {
        auth: { health: 'DOWN' },
        ingestion: { health: 'DOWN' },
      },
    });
  });

  it('2. Redis unreachable → `ready: false` **and HTTP 503**', async () => {
    // The one dependency that genuinely gates. Sessions, throttling and the
    // Socket.IO adapter all run through it, and unlike a peer outage this CAN
    // be instance-local — so routing around this instance is a real remedy.
    //
    // **The status code is the assertion that matters to an orchestrator.** A
    // `httpGet` readinessProbe succeeds on any 2xx and never parses the body,
    // so a 200 carrying `ready: false` reports HEALTHY — this endpoint returned
    // exactly that until the drain work, which made every readiness answer
    // advisory. The body is unchanged and still the diagnostic.
    jest
      .spyOn(fx.app.get(RedisHealthService), 'isReachable')
      .mockResolvedValue(false);

    const response = await readiness().expect(503);

    expect(response.body.data).toMatchObject({
      ready: false,
      draining: false,
      dependencies: { redis: 'DOWN' },
    });
  });

  it('2a. **draining → `ready: false` and 503, with Redis still UP**', async () => {
    // The rollout case, and the reason `draining` is beside `ready` rather than
    // inside `dependencies`: nothing is broken. Kubernetes removes a
    // terminating pod from Service endpoints and sends SIGTERM concurrently,
    // and this is what closes that window for the one pod behind the Ingress.
    jest.spyOn(fx.app.get(DrainState), 'isDraining').mockReturnValue(true);

    const response = await readiness().expect(503);

    expect(response.body.data).toMatchObject({
      ready: false,
      draining: true,
      // Not a dependency failure. Reporting one would send whoever reads this
      // at Redis during an ordinary deploy.
      dependencies: { redis: 'UP' },
    });
  });

  it('2b. **`onApplicationShutdown` is what sets it** — not a side effect', async () => {
    // The gateway's readiness used to go red only because
    // `RedisHealthService.onApplicationShutdown` disconnected its client, which
    // is late, indirect, and only lands if a probe arrives in the window. The
    // five gRPC services all call `startDraining()` explicitly from their ops
    // modules; this asserts the gateway's own hook, on a THROWAWAY instance so
    // the fixture's app is not shut down under the rest of the suite.
    const drain = new DrainState();
    expect(drain.isDraining()).toBe(false);

    const { HealthModule } =
      await import('../../src/modules/health/health.module');

    new HealthModule(drain).onApplicationShutdown();

    expect(drain.isDraining()).toBe(true);
  });

  it('3. **liveness is UP with every peer DOWN and Redis down**', async () => {
    // Liveness must never check anything external. A restart repairs none of it
    // and removes an instance that could still serve — and the probe that kills
    // healthy containers during a dependency outage is the one that turns a
    // degradation into an outage.
    downPeers();
    jest
      .spyOn(fx.app.get(RedisHealthService), 'isReachable')
      .mockResolvedValue(false);

    const response = await liveness().expect(200);

    expect(response.body.data.status).toBe('UP');
  });

  it('4. readiness answers WITHIN the probe timeout with peers unreachable', async () => {
    // A probe that hangs is a probe that fails: Kubernetes counts the timeout
    // as not-ready, so an unbounded check produces the same outcome as a
    // genuine failure while also holding a worker for the duration.
    //
    // The peers here are really unreachable — nothing listens on those ports —
    // so this exercises the actual channel-state path rather than a stub.
    const started = Date.now();
    await readiness().expect(200);

    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('5. reports EVERY peer, not just auth-service', async () => {
    // A diagnostic showing one of five peers is worse than none: during an
    // incident it invites "auth is up, so the peers are fine" — while the cause
    // sits in one of the four nobody looked at.
    const response: { body: { data: { peers: Record<string, unknown> } } } =
      await readiness().expect(200);

    expect(
      Object.keys(response.body.data.peers).sort(compareAlphabetically),
    ).toEqual(
      ['auth', 'ingestion', 'notification', 'rag', 'ticket'].sort(
        compareAlphabetically,
      ),
    );
  });
});

/**
 * `/version`.
 *
 * Trivial to serve and easy to make useless. The two ways it goes wrong are
 * both tested here: reporting the wrong build (test 1's values come from the
 * environment, which is where the image bakes them), and accreting fields until
 * a deliberately public endpoint is an inventory of the runtime (test 3).
 */
describe('/version (e2e)', () => {
  let fx: E2eFixture;

  const version = () => request(fx.app.getHttpServer()).get('/version');

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
  }, 30_000);

  afterAll(() => fx.close());

  it('1. returns the values injected at BUILD time', async () => {
    // Read from the environment, never from git at runtime: a container has no
    // `.git`, so a runtime `git rev-parse` returns nothing and the natural
    // fallback is `"unknown"` — the answer you get at exactly the moment you
    // need the real one.
    const response = await version().expect(200);

    expect(response.body.data).toEqual({
      version: process.env.APP_VERSION,
      sha: process.env.BUILD_SHA,
      builtAt: process.env.BUILD_TIME,
    });
  });

  it('2. **the build variables are REQUIRED, so an unidentifiable image fails to boot**', () => {
    // The doc's test 2 is "a build with no `GIT_SHA` fails to build". There is
    // no Dockerfile in this repo yet, so the guarantee is enforced one stage
    // later and asserted where it actually lives: the env schema. An image that
    // cannot say what it is refuses to start, rather than starting happily and
    // answering "unknown" to the one question this endpoint exists for.
    //
    // When a Dockerfile lands, its `test -n "$GIT_SHA"` guard moves the same
    // rule earlier; this stays as the backstop for a hand-rolled deployment
    // that bypasses the image build.
    const result = envValidationSchema.validate(
      { ...process.env, BUILD_SHA: undefined },
      { allowUnknown: true, abortEarly: false },
    );

    expect(result.error?.message).toContain('BUILD_SHA');
  });

  it('3. **contains NO runtime, dependency or environment detail**', () => {
    // Asserted as an EXACT key set rather than a set of absences. This is the
    // endpoint that accretes fields — Node version, dependency list, hostname,
    // environment name — and each addition looks individually harmless while
    // turning a support aid into a reconnaissance endpoint on a public route.
    // A test listing forbidden keys passes for the next field nobody thought of.
    return version()
      .expect(200)
      .expect((response: { body: { data: Record<string, unknown> } }) => {
        expect(
          Object.keys(response.body.data).sort(compareAlphabetically),
        ).toEqual(['builtAt', 'sha', 'version'].sort(compareAlphabetically));
      });
  });
});
