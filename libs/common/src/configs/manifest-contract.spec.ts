import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { envDocumentedKeys } from '../testing/env-file';
import { stripComments } from '../testing/strip-comments';

/**
 * The Kubernetes manifests, checked against the application they deploy.
 *
 * **Manifests are static files, so the same split the last three phases settled
 * on applies**: parse what can be parsed and leave the cluster to the cluster.
 * Nothing here needs a kubelet, an API server or a `kubectl`, which is what
 * lets it run on every `npm test` rather than whenever somebody remembers.
 *
 * The class of bug it exists for is drift between two files that must agree and
 * that nothing forces to: a `GRPC_PORT` moved in `.env.example` and not in the
 * probe, a secret path changed and not in the volume mount, a variable added to
 * a Joi schema and not to the ConfigMap. Each of those ships green and fails at
 * `kubectl rollout`, or worse, at the first request.
 *
 * Corpus discipline as `development-conventions.md` §13.8 requires it: every
 * corpus from `git ls-files --cached --others --exclude-standard` (never a
 * directory walk), `stripComments` before any TypeScript source is
 * pattern-matched, and a pattern-fires floor on each parse so a scan that
 * silently matches nothing fails instead of passing.
 */
describe('the manifest contract', () => {
  const REPO_ROOT = join(__dirname, '../../../..');

  const gitFiles = (pattern: string): string[] =>
    execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '--', pattern],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean);

  const read = (repoRelative: string): string =>
    readFileSync(join(REPO_ROOT, repoRelative), 'utf8');

  // -------------------------------------------------------------- the corpus

  type Doc = Record<string, unknown> & {
    kind?: string;
    metadata?: { name?: string };
    spec?: Record<string, unknown>;
    data?: Record<string, string>;
    stringData?: Record<string, string>;
  };

  /**
   * Every YAML document under `k8s/`, flattened across `---` separators.
   *
   * DIRECTORY pathspec, filtered in JS — measured, not assumed: in a git
   * pathspec without `:(glob)`, `*` is plain fnmatch and CROSSES `/`, while
   * a doubled star between two path components requires at least one
   * intervening component. So the doubled-star form of `k8s/*.yaml` would MISS
   * `k8s/ingress.yaml`, which sits directly in `k8s/` and is the one document
   * the ingress checks are about.
   */
  const manifests = (): { file: string; doc: Doc }[] =>
    gitFiles('k8s')
      .filter((file) => file.endsWith('.yaml'))
      .flatMap((file) =>
        // Split BEFORE parsing: `load` throws on a multi-document stream, and
        // every service file here is a Deployment and a Service in one.
        read(file)
          .split(/^---$/m)
          .map((chunk) => load(chunk, { json: true }) as Doc | undefined)
          .filter((doc): doc is Doc => Boolean(doc))
          .map((doc) => ({ file, doc })),
      );

  const byKind = (kind: string): { file: string; doc: Doc }[] =>
    manifests().filter(({ doc }) => doc.kind === kind);

  /** service → its Deployment, keyed on the metadata name. */
  const deployments = (): Map<string, Doc> =>
    new Map(
      byKind('Deployment').map(({ doc }) => [doc.metadata?.name ?? '', doc]),
    );

  const containersOf = (deployment: Doc): Record<string, unknown>[] => {
    const template = (deployment.spec as { template?: { spec?: unknown } })
      ?.template?.spec as
      { containers?: Record<string, unknown>[] } | undefined;

    return template?.containers ?? [];
  };

  const services = (): string[] =>
    gitFiles('apps/*/package.json')
      .map((file) => file.split('/')[1])
      .sort();

  const documented = (service: string): Set<string> =>
    envDocumentedKeys(read(`apps/${service}/.env.example`));

  const envValue = (service: string, key: string): string | undefined => {
    const match = new RegExp(`^#?\\s*${key}\\s*=(.*)$`, 'm').exec(
      read(`apps/${service}/.env.example`),
    );

    return match?.[1].trim();
  };

  // -------------------------------------------------------------- the floors

  it('**the corpus is not empty** — seven Deployments, seven Services, one Ingress', () => {
    // The pattern-fires floor every scan in this repo carries. Checks 1–6 all
    // iterate over this corpus, so a glob that matched nothing would make all
    // six vacuously green — the failure mode a check exists to prevent,
    // arriving through the check.
    expect(byKind('Deployment')).toHaveLength(7);
    // Nine: the seven application Services, plus `nats` and `qdrant`, which are
    // StatefulSets and need a Service each to be addressable.
    expect(byKind('Service')).toHaveLength(9);
    expect(
      byKind('Service')
        .map(({ doc }) => doc.metadata?.name ?? '')
        .filter((name) => services().includes(name))
        .sort(),
    ).toEqual(services());
    expect(byKind('Ingress')).toHaveLength(1);
    expect(byKind('StatefulSet')).toHaveLength(2);
    expect(byKind('NetworkPolicy')).toHaveLength(1);
    expect(byKind('ConfigMap')).toHaveLength(7);
    expect([...deployments().keys()].sort()).toEqual(services());
  });

  // ------------------------------------------------------- 1. the probe ports

  describe('1. every probe port is the port the service is configured to serve', () => {
    /**
     * **rag-service is the case that decides which parser this uses.** Its
     * `GRPC_PORT` lives on a COMMENTED line (`# GRPC_PORT = 50255`) because in
     * development the default is right — so a check reading only active lines
     * would cover five services and silently skip the sixth, which is also the
     * one whose port nothing else in the tree states.
     */
    const grpcServices = (): [string, number][] =>
      services()
        .filter((service) => documented(service).has('GRPC_PORT'))
        .map((service) => [service, Number(envValue(service, 'GRPC_PORT'))]);

    it('covers six gRPC services — the pattern-fires floor', () => {
      expect(grpcServices()).toHaveLength(6);
      expect(grpcServices().map(([service]) => service)).toContain(
        'rag-service',
      );
    });

    it.each(grpcServices())('%s serves %i', (service, port) => {
      const container = containersOf(deployments().get(service) as Doc)[0] as {
        ports?: { containerPort?: number }[];
        livenessProbe?: { grpc?: { port?: number } };
        readinessProbe?: { grpc?: { port?: number } };
      };

      expect([
        service,
        container.ports?.[0]?.containerPort,
        container.livenessProbe?.grpc?.port,
        container.readinessProbe?.grpc?.port,
      ]).toEqual([service, port, port, port]);
    });

    it('api-gateway probes HTTP on its own PORT, and never the metrics port', () => {
      // The one service with an HTTP listener, and the one whose metrics sit on
      // a SECOND port deliberately — `.env.example` calls that "what makes 'not
      // reachable from the internet' structural rather than an Nginx rule". A
      // probe pointed at 9464 would be checking the wrong listener.
      const container = containersOf(
        deployments().get('api-gateway') as Doc,
      )[0] as {
        ports?: { name?: string; containerPort?: number }[];
        livenessProbe?: { httpGet?: { path?: string; port?: string } };
        readinessProbe?: { httpGet?: { path?: string; port?: string } };
      };

      const named = Object.fromEntries(
        (container.ports ?? []).map((port) => [port.name, port.containerPort]),
      );

      expect(named).toEqual({
        http: Number(envValue('api-gateway', 'PORT')),
        metrics: Number(envValue('api-gateway', 'METRICS_PORT')),
      });
      expect(container.livenessProbe?.httpGet).toEqual({
        path: '/health',
        port: 'http',
      });
      expect(container.readinessProbe?.httpGet).toEqual({
        path: '/health/ready',
        port: 'http',
      });
    });
  });

  // --------------------------------------------------- 2. the probe SERVICE names

  it('2. **liveness asks `""` and readiness asks `"readiness"`**', () => {
    // `ops-controller.ts` answers NOT_FOUND to any other service name rather
    // than assuming liveness — "the failure that looks exactly like health".
    // That design only pays off if something notices the typo, and a probe
    // returning NOT_FOUND reads as an application fault: a pod that never
    // becomes ready, for a reason that looks like the code.
    const probes = byKind('Deployment').flatMap(({ doc }) =>
      containersOf(doc).map((container) => {
        const typed = container as {
          livenessProbe?: { grpc?: { service?: string } };
          readinessProbe?: { grpc?: { service?: string } };
        };

        return [typed.livenessProbe?.grpc, typed.readinessProbe?.grpc] as const;
      }),
    );

    const live = probes
      .map(([liveness]) => liveness)
      .filter((probe): probe is { service?: string } => Boolean(probe));
    const ready = probes
      .map(([, readiness]) => readiness)
      .filter((probe): probe is { service?: string } => Boolean(probe));

    // Six of the seven; api-gateway probes over HTTP.
    expect([live.length, ready.length]).toEqual([6, 6]);
    expect(live.map((probe) => probe.service)).toEqual(Array(6).fill(''));
    expect(ready.map((probe) => probe.service)).toEqual(
      Array(6).fill('readiness'),
    );
  });

  // ------------------------------------------------- 3. secrets are not config

  describe('3. a credential never lands in a ConfigMap', () => {
    const configMaps = () =>
      byKind('ConfigMap').map(({ doc }) => ({
        service: (doc.metadata?.name ?? '').replace(/-config$/, ''),
        keys: Object.keys(doc.data ?? {}),
      }));

    it('**no key appears in both a Secret and a ConfigMap**', () => {
      // A variable in both is a credential in a ConfigMap: readable by anything
      // that can `get configmaps`, printed by `kubectl describe`, and shadowed
      // at runtime by whichever `envFrom` entry Kubernetes merges last — so the
      // exposure survives even when the value being USED is the secret one.
      const config = new Map(
        configMaps().map(({ service, keys }) => [service, new Set(keys)]),
      );

      const overlaps: string[] = [];

      for (const { doc } of byKind('Secret')) {
        const service = (doc.metadata?.name ?? '').replace(/-secret$/, '');
        const keys = config.get(service) ?? new Set<string>();

        for (const key of Object.keys(doc.stringData ?? {})) {
          if (keys.has(key)) overlaps.push(`${service}: ${key}`);
        }
      }

      expect(overlaps).toEqual([]);
    });

    /**
     * **The half the obvious check misses, found by sabotaging it.**
     *
     * "No key in both" only catches DUPLICATION. Deleting `STRIPE_SECRET_KEY`
     * from the generator's secret set was measured to move it cleanly into the
     * ConfigMap and out of the Secret — one place, not two — and the
     * overlap check came back green on a Stripe API key sitting in
     * `kubectl describe` output. Misclassification is the hazard; duplication
     * is only its noisiest form.
     *
     * So this states "is a credential" a SECOND time, from the name alone and
     * independently of `generate-k8s-config.mjs`'s list. Two statements of one
     * fact is what makes a single edit to either of them fail.
     */
    /**
     * **Anchored at the END, and that is the whole difficulty.** A first
     * version matched the noun anywhere and flagged three real config keys:
     * `DEVICE_TOKEN_NAME` (a cookie name), `REFRESH_TOKEN_TTL_DAYS` and
     * `PASSWORD_RESET_TTL_MINUTES` (both durations). Every credential in this
     * repository ENDS with what it is; every near-miss ends with what it is
     * ABOUT — `_NAME`, `_PATH`, `_TTL_DAYS`.
     */
    const CREDENTIAL =
      /(?:^|_)(?:SECRET|PASSWORD|PASS|TOKEN)$|_(?:API_KEY|MASTER_KEY|SECRET_KEY)$|^(?:DATABASE_URL|REDIS_URL)$/;

    /**
     * Credentials no name pattern reaches, each with the reason a pattern
     * cannot — TWINLESS, so an omission cannot dress up as an exemption.
     */
    const ALSO_CREDENTIAL: Readonly<Record<string, string>> = {
      TWILIO_SID: 'an account identifier that is half of a Basic auth pair',
      TWILIO_AUTH_PHONE:
        'not secret in itself, but it travels with the pair and splitting them across two objects is how one gets rotated alone',
      INGESTION_DATABASE_URL:
        "rag-service's read-only handle on ingestion's database — a DSN with a password, spelled differently",
    };

    it('the pattern fires — it matches the credentials we know about', () => {
      // A regex that silently stopped matching would make the check below
      // vacuous. These are real keys from real `.env.example` files.
      expect(
        [
          'STRIPE_SECRET_KEY',
          'STRIPE_WEBHOOK_SECRET',
          'SUPER_ADMIN_PASSWORD',
          'EMAIL_PASS',
          'TWILIO_AUTH_TOKEN',
          'GEMINI_API_KEY',
          'INBOUND_EMAIL_SECRET',
          'TWO_FACTOR_MASTER_KEY',
          'DATABASE_URL',
          'REDIS_URL',
        ].filter((key) => !CREDENTIAL.test(key)),
      ).toEqual([]);

      // And does NOT match the near-misses, which are paths and cookie names.
      expect(
        [
          'JWT_ACCESS_PUBLIC_KEY_PATH',
          'JWT_ACCESS_PRIVATE_KEY_PATH',
          'JWT_ACCESS_NAME',
          'DEVICE_TOKEN_NAME',
          'TENANT_SELECTION_NAME',
          // The three a mid-name match flagged, measured.
          'REFRESH_TOKEN_TTL_DAYS',
          'PASSWORD_RESET_TTL_MINUTES',
          'BACKUP_CODE_TTL_DAYS',
        ].filter((key) => CREDENTIAL.test(key)),
      ).toEqual([]);
    });

    it.each(configMaps())('$service holds no credential', ({ keys }) => {
      expect(
        keys.filter((key) => CREDENTIAL.test(key) || key in ALSO_CREDENTIAL),
      ).toEqual([]);
    });
  });

  // ------------------------------------- 4. the schema's keys reach the pod

  describe('4. every variable a service validates is present in its ConfigMap or Secret', () => {
    /**
     * **Key sets, never "which are required".** That reads like the sharper
     * assertion and there is no mechanism for it: measured,
     * `envValidationSchema.extract('SUPER_ADMIN_PASSWORD')` throws
     * `Invalid reference exceeds the schema root: ref:NODE_ENV` for any field
     * carrying a `when()`, and `describe()` reports presence flags that a
     * `when()` branch overrides. Presence is answerable; obligation is not.
     *
     * This is the THIRD instance of one guard. `env-contract.spec.ts` compares
     * the schema against `.env.example`; `image-contract.spec.ts` pins
     * `.env.docker` as generated-not-tracked; this compares the schema against
     * the manifest. Because the ConfigMaps are GENERATED from `.env.example`,
     * the three close the drift class between all four value-sets.
     */
    const BUILD_INJECTED = new Set(['APP_VERSION', 'BUILD_SHA', 'BUILD_TIME']);

    /**
     * Documented and deliberately absent from the cluster, mirroring
     * `generate-k8s-config.mjs`'s own list. Two copies of one fact, and this is
     * the copy that fails if they diverge: an exclusion dropped there appears
     * here as a missing key.
     */
    const EXCLUDED = new Set(['FIREBASE_STORAGE_EMULATOR_HOST']);

    /** rag-service declares its variables in Python; its guard is pytest. */
    const GUARDED_ELSEWHERE: Readonly<Record<string, string>> = {
      'rag-service': 'pytest: apps/rag-service/tests/test_env_contract.py',
    };

    const schemaFiles = (): Map<string, string> => {
      const map = new Map<string, string>();

      for (const file of gitFiles('apps/*/src/**/env.validation.ts')) {
        map.set(file.split('/')[1], file);
      }

      return map;
    };

    const schemaKeys = (repoRelative: string): Set<string> => {
      const source = stripComments(read(repoRelative));
      const keys = new Set<string>();

      for (const match of source.matchAll(/^ {2}([A-Z][A-Z0-9_]*):/gm)) {
        keys.add(match[1]);
      }

      return keys;
    };

    it('covers every service — a moved schema fails rather than skips', () => {
      expect(
        [...schemaFiles().keys(), ...Object.keys(GUARDED_ELSEWHERE)].sort(),
      ).toEqual(services());
    });

    it.each([...schemaFiles().entries()])('%s', (service, schemaPath) => {
      const keys = schemaKeys(schemaPath);
      expect(keys.size).toBeGreaterThanOrEqual(10);

      const configMap = byKind('ConfigMap').find(
        ({ doc }) => doc.metadata?.name === `${service}-config`,
      );
      const secret = byKind('Secret').find(
        ({ doc }) => doc.metadata?.name === `${service}-secret`,
      );

      const supplied = new Set([
        ...Object.keys(configMap?.doc.data ?? {}),
        ...Object.keys(secret?.doc.stringData ?? {}),
        ...BUILD_INJECTED,
        ...EXCLUDED,
      ]);

      expect([...keys].filter((key) => !supplied.has(key)).sort()).toEqual([]);
    });

    it('rag-service too, from its own declaration site', () => {
      // Its config is Python, so the key list comes from `config.py` rather
      // than a Joi schema — but the manifest half of the question is identical
      // and there is no reason for the one non-Node service to be exempt from
      // it.
      const source = read('apps/rag-service/rag_service/config.py');
      const keys = new Set(
        [...source.matchAll(/["']([A-Z][A-Z0-9_]{2,})["']/g)].map(
          (match) => match[1],
        ),
      );

      expect(keys.size).toBeGreaterThanOrEqual(5);

      const supplied = new Set([
        ...Object.keys(
          byKind('ConfigMap').find(
            ({ doc }) => doc.metadata?.name === 'rag-service-config',
          )?.doc.data ?? {},
        ),
        ...Object.keys(
          byKind('Secret').find(
            ({ doc }) => doc.metadata?.name === 'rag-service-secret',
          )?.doc.stringData ?? {},
        ),
      ]);

      // Narrowed to the ones `.env.example` also documents, so a plain string
      // constant in `config.py` that happens to be SHOUTY does not read as a
      // variable. All ten intersect today; the floor is what stops the filter
      // from quietly emptying the corpus.
      const documentedByRag = documented('rag-service');
      const checked = [...keys].filter((key) => documentedByRag.has(key));

      expect(checked.length).toBeGreaterThanOrEqual(8);
      expect(checked.filter((key) => !supplied.has(key)).sort()).toEqual([]);
    });
  });

  // ------------------------------ 4a. the one value three surfaces must share

  it('**`INBOUND_EMAIL_SECRET` is present in BOTH Secrets that need it**', () => {
    // **A PRESENCE check, and the direction is the point.** Check 3 above says
    // no credential lands in a ConfigMap — an exclusion, and Phase 4's own green
    // sabotage showed what an exclusion misses: a key that moves ENTIRELY out of
    // the Secret satisfies "not in both" while sitting somewhere it should not.
    // The mirror failure is a key that is simply absent, and this catches that.
    //
    // **One value, two deployment surfaces.** `inbound-email.config.ts` opens
    // with *"One definition, two readers"*: the gateway parses the per-ticket
    // reply token, and notification-service MINTS that reply token into
    // `Reply-To`.
    //
    // **The agreement fails quietly.** A notification/gateway mismatch makes
    // `parseTicketReplyToken` return `null` and the caller open a NEW ticket —
    // correctly and deliberately, since threading a stranger's mail onto
    // somebody else's conversation is a disclosure — with nothing in a log. It
    // presents weeks later as "threading stopped working", which is the hardest
    // possible attribution, and a partial rotation is worse than a wrong one
    // because half of it keeps working.
    const KEY = 'INBOUND_EMAIL_SECRET';
    const HOLDERS = ['api-gateway', 'notification-service'];

    const holdersInSecrets = HOLDERS.filter((service) =>
      Object.keys(
        byKind('Secret').find(
          ({ doc }) => doc.metadata?.name === `${service}-secret`,
        )?.doc.stringData ?? {},
      ).includes(KEY),
    );

    expect(holdersInSecrets).toEqual(HOLDERS);

    // Derived rather than asserted from the list above: the services whose Joi
    // schema NAMES the variable are the services that must hold it, so a third
    // consumer added later fails here instead of shipping with no Secret.
    const declaring = gitFiles('apps/*/src/**/env.validation.ts')
      .filter((file) => stripComments(read(file)).includes(`${KEY}:`))
      .map((file) => file.split('/')[1])
      .sort();

    expect(declaring).toEqual(HOLDERS);
  });

  // ------------------------------------------------ 5. ingestion's memory limit

  it("5. **ingestion's memory limit is derived, not compared**", () => {
    // `>= the heap cap` is the assertion that reads right and passes the
    // failure it exists to catch: 800Mi clears a 768 MB `--max-old-space-size`
    // and OOMKills on the second concurrent parse, because the two raw
    // `Buffer`s live OUTSIDE the V8 heap and the flag does not bound them.
    //
    // Both inputs are constants this spec can read, so the floor is computed
    // from them rather than restated: heap + MAX_DOCUMENT_BYTES x concurrency.
    const heapMb = Number(
      /--max-old-space-size=(\d+)/.exec(
        read('docker/node-service.Dockerfile'),
      )?.[1],
    );
    const documentBytes = read('libs/common/src/configs/document.config.ts');
    const maxDocumentMb = Number(
      /MAX_DOCUMENT_BYTES = (\d+) \* 1024 \* 1024/.exec(documentBytes)?.[1],
    );
    const concurrency = Number(
      /concurrency:\s*(\d+)/.exec(
        read(
          'apps/ingestion-service/src/modules/ingestion/ingestion.worker.ts',
        ),
      )?.[1],
    );

    // Pattern-fires floor: three regexes, and a NaN from any one of them would
    // make the comparison below vacuous rather than red.
    expect([heapMb, maxDocumentMb, concurrency]).toEqual([768, 100, 2]);

    const container = containersOf(
      deployments().get('ingestion-service') as Doc,
    )[0] as { resources?: { limits?: { memory?: string } } };

    const limitMi = Number(
      /^(\d+)Mi$/.exec(container.resources?.limits?.memory ?? '')?.[1],
    );

    expect(limitMi).toBeGreaterThanOrEqual(
      heapMb + maxDocumentMb * concurrency,
    );
  });

  // ----------------------------------------- 6. secret files reach their paths

  it('6. **every `*_PATH` in a ConfigMap has a mount that resolves it**', () => {
    // §6's own hazard, made unrepeatable. Three Firebase service accounts,
    // three variable names, two directory conventions — auth's under
    // `secrets/`, storage's and notification's at the package root — and the
    // first draft of the table listing them put auth's in the wrong one.
    //
    // `WORKDIR` is `/app/apps/${SERVICE}`, so a relative `./secrets/x.key`
    // resolves there; the mount is either that directory or that exact file via
    // `subPath`. Derived, so a path changed in `.env.example` and not in the
    // Deployment goes red instead of failing at `readFileSync` on boot.
    const findings: string[] = [];
    let checked = 0;

    for (const { doc } of byKind('ConfigMap')) {
      const service = (doc.metadata?.name ?? '').replace(/-config$/, '');

      for (const [key, value] of Object.entries(doc.data ?? {})) {
        if (!key.endsWith('_PATH') || !value.startsWith('./')) continue;

        checked += 1;
        const resolved = `/app/apps/${service}/${value.slice(2)}`;
        const directory = resolved.slice(0, resolved.lastIndexOf('/'));

        const mounts = containersOf(deployments().get(service) as Doc).flatMap(
          (container) =>
            (
              (container as { volumeMounts?: { mountPath?: string }[] })
                .volumeMounts ?? []
            ).map((mount) => mount.mountPath),
        );

        if (!mounts.includes(resolved) && !mounts.includes(directory)) {
          findings.push(
            `${service}: ${key}=${value} -> no mount at ${resolved}`,
          );
        }
      }
    }

    // Seven `*_PATH` values across four services. A regex that stopped matching
    // would report a clean tree.
    expect(checked).toBe(7);
    expect(findings).toEqual([]);
  });

  // ------------------------------------------------- 7. generated stays generated

  it('7. **`k8s/generated/` is a function of `apps/*/.env.example`**', () => {
    // Same shape as `job-alerts.spec.ts`: the generator's own `--check` mode is
    // the authority, so this cannot drift from it by reimplementing the rule.
    // A ConfigMap edited by hand is a value the next regeneration silently
    // reverts — the drift class `env-contract.spec.ts` closed for
    // `.env.example` and `image-contract.spec.ts` for `.env.docker`, arriving
    // through a third file.
    expect(() =>
      execFileSync(
        'node',
        [join(REPO_ROOT, 'scripts/generate-k8s-config.mjs'), '--check'],
        { cwd: REPO_ROOT, encoding: 'utf8', stdio: 'pipe' },
      ),
    ).not.toThrow();
  });

  // ---------------------------------- 8. the init container follows the schema

  it('8. **an init container exists exactly where a Prisma schema does**', () => {
    // ADR 0043 gates the `migrate` image target on `prisma/schema.prisma`
    // existing rather than on a list of services; this is the same derivation
    // on the manifest side. Three of the seven own no schema, and an init
    // container on one of them would run `migrate deploy` against nothing and
    // hold the pod at `Init:Error` forever.
    const withSchema = new Set(
      gitFiles('apps/*/prisma/schema.prisma').map((file) => file.split('/')[1]),
    );

    expect(withSchema.size).toBe(4);

    const withInit = new Set(
      byKind('Deployment')
        .filter(({ doc }) =>
          Boolean(
            (
              (
                doc.spec as {
                  template?: { spec?: { initContainers?: unknown[] } };
                }
              )?.template?.spec?.initContainers ?? []
            ).length,
          ),
        )
        .map(({ doc }) => doc.metadata?.name ?? ''),
    );

    expect([...withInit].sort()).toEqual([...withSchema].sort());
  });
});
