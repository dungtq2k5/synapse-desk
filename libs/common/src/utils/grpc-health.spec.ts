import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  GrpcHealthService,
  NOT_SERVING,
  READINESS_PROBE_TIMEOUT_MS,
  SERVING,
  type DependencyProbe,
} from './grpc-health';

/**
 * The shared gRPC health service — 23-doc §2.
 *
 * Two of these are behavioural and two are the RULE: that no service's
 * readiness references another service. That rule decays first, because "we
 * depend on it, so check it" always looks like diligence — and the consequence
 * is §1's outage happening one level down, where a single Postgres failure in
 * one service takes every service out of rotation.
 */
describe('§2 GrpcHealthService', () => {
  const REPO_ROOT = join(__dirname, '../../../..');

  const up = (name: string): DependencyProbe => ({
    name,
    check: () => Promise.resolve(true),
  });

  const down = (name: string): DependencyProbe => ({
    name,
    check: () => Promise.resolve(false),
  });

  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it('1. SERVING when every owned dependency is up', async () => {
    const health = new GrpcHealthService([up('postgres'), up('nats')]);

    await expect(health.readiness()).resolves.toEqual({ status: SERVING });
  });

  it('2. **Postgres down → NOT_SERVING for readiness, SERVING for liveness**', async () => {
    // The distinction, and it is not a nicety. A failing LIVENESS probe gets
    // the container killed, which repairs nothing when the cause is a database
    // — and does it on every replica at once, so the outage that was "reads are
    // failing" becomes "there is no service".
    const health = new GrpcHealthService([down('postgres'), up('nats')]);

    await expect(health.readiness()).resolves.toEqual({ status: NOT_SERVING });
    expect(health.liveness()).toEqual({ status: SERVING });
  });

  it('3. a probe that HANGS is bounded, not waited on', async () => {
    // A dependency that has stopped answering usually accepts the connection
    // and never replies. An unbounded check therefore burns the kubelet's whole
    // probe timeout and is counted as a failure anyway — having also held a
    // connection open for the duration. Wrong-and-fast beats right-and-too-late.
    jest.useFakeTimers();

    const health = new GrpcHealthService([
      { name: 'wedged', check: () => new Promise<boolean>(() => {}) },
    ]);

    const answer = health.readiness();
    jest.advanceTimersByTime(READINESS_PROBE_TIMEOUT_MS + 10);

    await expect(answer).resolves.toEqual({ status: NOT_SERVING });
    jest.useRealTimers();
  });

  it('4. a THROWING probe answers NOT_SERVING rather than erroring the RPC', async () => {
    // An exception escaping the handler answers the health check with a gRPC
    // error, which a kubelet reads as "unknown" rather than "not ready" — so a
    // service whose database is refusing connections would stay in rotation.
    const health = new GrpcHealthService([
      {
        name: 'exploding',
        check: () => Promise.reject(new Error('connection refused')),
      },
    ]);

    await expect(health.readiness()).resolves.toEqual({ status: NOT_SERVING });
  });

  it('5. **draining reports NOT_SERVING before the port closes**', async () => {
    // Without this a pod answers SERVING right up to the moment it stops
    // listening, so the load balancer keeps handing it work it will never
    // finish — every rolling deploy becomes a small burst of failed requests.
    const health = new GrpcHealthService([up('postgres')]);
    health.startDraining();

    await expect(health.readiness()).resolves.toEqual({ status: NOT_SERVING });
    // Liveness stays SERVING: the process is alive and is finishing its work.
    // Reporting otherwise would invite a restart mid-drain.
    expect(health.liveness()).toEqual({ status: SERVING });
  });

  /**
   * The static half — 23-doc §2 test 3.
   *
   * A grep-style assertion rather than a behavioural one, because the failure it
   * guards against is a line somebody ADDS in good faith. There is no state to
   * observe: a readiness probe that calls auth-service looks correct, passes its
   * own test, and only misbehaves when auth-service is down — which is exactly
   * when nobody wants to discover it.
   */
  describe('6. no service probes ANOTHER service', () => {
    const OPS_MODULES = [
      'apps/auth-service/src/modules/ops/ops.module.ts',
      'apps/ticket-service/src/modules/ops/ops.module.ts',
      'apps/ingestion-service/src/modules/ops/ops.module.ts',
      'apps/notification-service/src/modules/ops/ops.module.ts',
      'apps/storage-service/src/modules/ops/ops.module.ts',
    ];

    /**
     * The clients a service uses to reach a PEER. Any of these appearing in an
     * ops module means a readiness probe has started depending on another
     * service being up.
     */
    const PEER_CLIENTS = [
      'AuthClient',
      'AuthGrpcClient',
      'TicketGrpcClient',
      'IngestionGrpcClient',
      'RagGrpcClient',
      'StorageReference',
      'AUTH_GRPC_CLIENT',
      'TICKET_GRPC_CLIENT',
      'INGESTION_GRPC_CLIENT',
      'RAG_GRPC_CLIENT',
      'STORAGE_GRPC_CLIENT',
      'NOTIFICATION_GRPC_CLIENT',
    ];

    it.each(OPS_MODULES)('%s references no peer client', (relative) => {
      const source = readFileSync(join(REPO_ROOT, relative), 'utf8');
      // Comments are where the rule is EXPLAINED — every one of these files
      // names auth-service to say why it is absent — so they are stripped
      // before the check. Without this the test would fail on its own
      // documentation.
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');

      const found = PEER_CLIENTS.filter((client) => code.includes(client));

      expect(found).toEqual([]);
    });

    it('**every gRPC service has one** — derived, not hand-listed', () => {
      // Guards the guard. A service added without an ops module would be
      // unprobeable AND silently exempt from the rule above, and `OPS_MODULES`
      // is a hand-written array — exactly the kind that stops being true.
      //
      // So the expected set is DERIVED from the filesystem: any app whose
      // `main.ts` calls `createMicroservice` is a gRPC service and must be
      // probeable. A new service is covered the moment it exists, which is
      // precisely when the omission would otherwise be made.
      const grpcServices = readdirSync(join(REPO_ROOT, 'apps'))
        .filter((app) => {
          const main = join(REPO_ROOT, 'apps', app, 'src/main.ts');
          return (
            existsSync(main) &&
            readFileSync(main, 'utf8').includes('createMicroservice')
          );
        })
        .sort();

      expect(grpcServices.length).toBeGreaterThan(0);
      expect(
        grpcServices.filter(
          (service) =>
            !OPS_MODULES.some((path) => path.startsWith(`apps/${service}/`)),
        ),
      ).toEqual([]);
    });
  });
});
