import 'reflect-metadata';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OrgAccess } from '@synapsedesk/common';
import { ORG_ACCESS_KEY } from '../decorators/org-access.decorator';
import { OPS_ROUTES } from '../../modules/health/ops-routes';

/**
 * Which tenant-lifecycle category every route has, and whether `JwtAuthGuard`
 * authenticates it — the table the Java gateway's gate is held to.
 *
 * The gate's decision for a request is a function of its route: the declared
 * `@OrgAccessKind`, else READ for a GET or HEAD and WRITE for anything else, and
 * only where `JwtAuthGuard` ran (Node gates on `request.user`, which that guard
 * populates). Java has no guard layer and declares the kind on its handlers, so a
 * route Java reads as WRITE where Node reads AUTH locks a frozen tenant's members
 * out of signing in, and the reverse lets a frozen tenant write. A handful of
 * contract rows cannot show that every route agrees; this table lists them all.
 *
 * It is RECOMPUTED from the controllers' own metadata on every run, so it cannot
 * drift from the code it describes; the committed copy exists for the Java side to
 * read. Written only when `UPDATE_ORG_ACCESS_FIXTURE=1`, never silently.
 */
describe('the tenant-lifecycle category of every route', () => {
  const FIXTURE = join(
    __dirname,
    '../../../test/fixtures/lifecycle/org-access-routes.json',
  );
  const METHODS = [
    'GET',
    'POST',
    'PUT',
    'DELETE',
    'PATCH',
    'ALL',
    'OPTIONS',
    'HEAD',
  ];

  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return walk(full);

      return full.endsWith('.controller.ts') ? [full] : [];
    });

  const join2 = (...parts: string[]): string =>
    '/' +
    parts
      .flatMap((part) => part.split('/'))
      .filter(Boolean)
      .join('/');

  const hasGuard = (target: object, name: string): boolean =>
    (
      (Reflect.getMetadata('__guards__', target) as { name?: string }[]) ?? []
    ).some((guard) => guard.name === name);

  const isJwtGuarded = (target: object): boolean =>
    hasGuard(target, 'JwtAuthGuard');

  /**
   * Refused by `SuperAdminGuard` before the gate runs, unless the caller is a super
   * admin, whom the gate exempts. Either way the gate never decides on this route,
   * which is what lets Java (whose super-admin check is inline, in the handler,
   * AFTER its gate) exempt the route outright and still answer as Node does.
   */
  const isSuperAdminOnly = (target: object): boolean =>
    hasGuard(target, 'SuperAdminGuard');

  const compute = (): [string, string, string, boolean, boolean][] => {
    const rows: [string, string, string, boolean, boolean][] = [];
    const ops = new Set<string>(
      (OPS_ROUTES as readonly unknown[]).map((route) =>
        join2(
          typeof route === 'string' ? route : (route as { path: string }).path,
        ),
      ),
    );

    for (const file of walk(join(__dirname, '../../modules'))) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const loaded = require(file) as Record<string, unknown>;

      for (const controller of Object.values(loaded)) {
        if (typeof controller !== 'function') continue;
        const base = Reflect.getMetadata('path', controller) as
          string | undefined;
        if (base === undefined) continue;

        const proto = (controller as { prototype: Record<string, unknown> })
          .prototype;
        for (const name of Object.getOwnPropertyNames(proto)) {
          const handler = proto[name];
          if (typeof handler !== 'function') continue;
          const verb = Reflect.getMetadata('method', handler) as
            number | undefined;
          if (verb === undefined) continue;

          const own = (Reflect.getMetadata('path', handler) as string) ?? '/';
          const relative = join2(base, own);
          const method = METHODS[verb];
          const path = (
            ops.has(relative) ? relative : join2('api', 'v1', relative)
          ).replace(/:(\w+)/gu, '{$1}');

          const declared =
            (Reflect.getMetadata(ORG_ACCESS_KEY, handler) as
              OrgAccess | undefined) ??
            (Reflect.getMetadata(ORG_ACCESS_KEY, controller) as
              OrgAccess | undefined);
          const kind =
            declared ??
            (method === 'GET' || method === 'HEAD'
              ? OrgAccess.READ
              : OrgAccess.WRITE);

          rows.push([
            method,
            path,
            String(kind),
            isJwtGuarded(handler) || isJwtGuarded(controller),
            isSuperAdminOnly(handler) || isSuperAdminOnly(controller),
          ]);
        }
      }
    }

    return rows.sort((a, b) =>
      `${a[1]} ${a[0]}`.localeCompare(`${b[1]} ${b[0]}`),
    );
  };

  const routes = compute();

  it('**covers the whole API, and the document knows every route it lists**', () => {
    const document = JSON.parse(
      readFileSync(
        join(__dirname, '../../../../../docs/reference/openapi.json'),
        'utf8',
      ),
    ) as { paths: Record<string, Record<string, unknown>> };
    const documented = new Set(
      Object.entries(document.paths).flatMap(([path, ops]) =>
        Object.keys(ops).map((method) => `${method.toUpperCase()} ${path}`),
      ),
    );

    // A walk that found nothing would report a perfectly satisfied contract.
    expect(routes.length).toBeGreaterThan(200);
    // Every route this table lists is a documented operation, so a wrong prefix
    // or a mangled path shows up here and not as a quiet Java mismatch.
    expect(
      routes
        .filter(([method, path]) => !documented.has(`${method} ${path}`))
        .map(([method, path]) => `${method} ${path}`),
    ).toEqual([]);
  });

  it('**uses every kind the gate knows**, so none is untested by the table', () => {
    expect(new Set(routes.map((route) => route[2]))).toEqual(
      new Set(Object.values(OrgAccess).map(String)),
    );
  });

  it('is the committed fixture the Java gateway is held to', () => {
    if (process.env.UPDATE_ORG_ACCESS_FIXTURE === '1') {
      writeFileSync(FIXTURE, JSON.stringify(routes, null, 1) + '\n');
    }

    expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(routes);
  });
});
