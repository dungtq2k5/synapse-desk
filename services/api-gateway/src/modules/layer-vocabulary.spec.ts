import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `docs/development-conventions.md` 6.3 — each layer owns one type vocabulary —
 * enforced by imports rather than by review.
 *
 * A client speaks proto, a mapper turns proto into a DTO, a service returns a
 * DTO, and a controller or resolver returns whatever the service gave it. The
 * table is only worth writing down if something checks it, because every
 * violation of it compiles: a resolver that maps is ordinary TypeScript, and it
 * reads as helpful right up to the point a second route over the same RPC
 * shapes its response differently.
 */
describe('Each layer owns one type vocabulary', () => {
  const MODULES_DIR = __dirname;

  const walkFiles = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walkFiles(path, out);
      else out.push(path);
    }

    return out;
  };

  const sourceFiles = walkFiles(MODULES_DIR).filter(
    (path) => path.endsWith('.ts') && !path.endsWith('.spec.ts'),
  );

  const named = (suffix: string) =>
    sourceFiles
      .filter((path) => path.endsWith(suffix))
      .map((path) => ({
        name: path.slice(path.lastIndexOf('/') + 1),
        path,
        imports: [
          ...readFileSync(path, 'utf8').matchAll(/from '([^']+)';/g),
        ].map((match) => match[1]),
      }));

  it('1. the scan finds the files it judges', () => {
    // Guards the guard: an empty list makes every assertion below vacuous, and
    // a vacuous architecture test is worse than none — it reports compliance.
    expect(named('-grpc.client.ts').length).toBeGreaterThanOrEqual(20);
    expect(named('.controller.ts').length).toBeGreaterThanOrEqual(20);
    expect(named('.resolver.ts').length).toBeGreaterThanOrEqual(5);
  });

  it('2. a gRPC client imports no DTO and no mapper', () => {
    const offenders = named('-grpc.client.ts').flatMap(({ name, imports }) =>
      imports
        .filter((from) => from.includes('/dto') || from.includes('.mapper'))
        .map((from) => `${name} -> ${from}`),
    );

    expect(offenders).toEqual([]);
  });

  it('3. every gRPC client has a service beside it', () => {
    const orphans = named('-grpc.client.ts')
      .filter(({ path }) => {
        const dir = path.slice(0, path.lastIndexOf('/'));

        return !readdirSync(dir).some((entry) => entry.endsWith('.service.ts'));
      })
      .map(({ name }) => name);

    // A client with no service is a client whose consumer does the mapping.
    expect(orphans).toEqual([]);
  });

  it('4. a controller or resolver never imports a gRPC client', () => {
    const offenders = [
      ...named('.controller.ts'),
      ...named('.resolver.ts'),
    ].flatMap(({ name, imports }) =>
      imports
        .filter((from) => from.endsWith('-grpc.client'))
        .map((from) => `${name} -> ${from}`),
    );

    expect(offenders).toEqual([]);
  });

  it('5. a controller or resolver never imports a mapper', () => {
    const offenders = [
      ...named('.controller.ts'),
      ...named('.resolver.ts'),
    ].flatMap(({ name, imports }) =>
      imports
        .filter((from) => from.includes('.mapper'))
        .map((from) => `${name} -> ${from}`),
    );

    // `toPageQuery` is deliberately NOT caught here: it lives in
    // `common/graphql/page-query.ts` because binding arguments into a query is
    // a routing layer's job. The prohibition is on shaping what comes back.
    expect(offenders).toEqual([]);
  });
});
