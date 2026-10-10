import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, repoFiles } from '@synapsedesk/testing/repo-files';

/**
 * `@synapsedesk/contracts` and `@synapsedesk/core` stay usable in a browser.
 *
 * A client imports them for event names, enum values, limits and pure helpers.
 * One import of a Node built-in, Nest, gRPC, Redis or NATS anywhere in them
 * makes the package unusable where those do not exist, and the failure shows up
 * in the client's build, far from the line that caused it. `import type` counts
 * too: the types it names do not exist there either.
 *
 * So, scanned from the code: every file under either package's `src` imports
 * only relative paths and, from `core`, `@synapsedesk/contracts`. Neither
 * manifest declares a runtime dependency beyond that one.
 */
describe('contracts and core are browser-safe', () => {
  /** What each package may import besides its own relative paths. */
  const ALLOWED: Record<string, ReadonlySet<string>> = {
    contracts: new Set(),
    core: new Set(['@synapsedesk/contracts']),
  };

  /** Every module specifier in `source`: static, `export … from`, and `import()`. */
  const specifiers = (source: string): string[] =>
    [
      ...source.matchAll(
        /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g,
      ),
      ...source.matchAll(/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g),
      ...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
      ...source.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g),
    ].map((match) => match[1]);

  it.each(Object.keys(ALLOWED))(
    '`%s` imports nothing but itself (and what it may)',
    (pkg) => {
      const files = repoFiles(`packages/${pkg}/src`).filter((file) =>
        file.endsWith('.ts'),
      );
      // The pattern-fires floor: a pathspec that matched nothing would pass.
      expect(files.length).toBeGreaterThan(10);

      const found = files.flatMap((file) =>
        specifiers(readFileSync(join(REPO_ROOT, file), 'utf8'))
          .filter((spec) => !spec.startsWith('.'))
          .filter((spec) => !ALLOWED[pkg].has(spec))
          .map((spec) => `${file}: ${spec}`),
      );

      expect(found).toEqual([]);
    },
  );

  it('the scan sees an import it must refuse', () => {
    // Without this, a regex that matched nothing would report both packages clean.
    expect(specifiers("import { randomUUID } from 'node:crypto';")).toEqual([
      'node:crypto',
    ]);
    expect(specifiers("import type { Redis } from 'ioredis';")).toEqual([
      'ioredis',
    ]);
    expect(
      specifiers("export {\n  a,\n  b,\n} from '@nestjs/common';"),
    ).toEqual(['@nestjs/common']);
  });

  it.each(Object.keys(ALLOWED))(
    '`%s` declares no runtime dependency beyond what it may import',
    (pkg) => {
      const manifest = JSON.parse(
        readFileSync(join(REPO_ROOT, `packages/${pkg}/package.json`), 'utf8'),
      ) as { dependencies?: Record<string, string> };

      expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual(
        [...ALLOWED[pkg]].sort(),
      );
    },
  );
});
