import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { readRepoFiles, repoFiles } from '@synapsedesk/testing/repo-files';
import { stripComments } from '@synapsedesk/testing/strip-comments';

/**
 * The web client's boundaries, read from the files.
 *
 * - **No `fetch(` outside the two fetchers.** The browser fetcher holds the 401
 *   handling, the server fetcher holds `cache: 'no-store'`; a third caller of
 *   `fetch` would have neither.
 * - **The generated clients are never committed.** They're generated from the
 *   committed document before every build, so a committed copy could only drift.
 */
describe('the web client', () => {
  const REPO_ROOT = join(__dirname, '../../..');

  /** The files allowed to call `fetch` directly. */
  const FETCHERS = new Set([
    'packages/api-client/src/browser-fetcher.ts',
    'apps/web/src/server/server-fetcher.ts',
  ]);

  /** A call of `fetch` (bare or as a member), not `customFetch(` or `prefetch(`. */
  const FETCH_CALL = /(?<![\w$])fetch\s*\(/;

  const clientSources = () =>
    readRepoFiles('packages/api-client/src', 'apps/web/src').filter(
      ({ path }) =>
        /\.(ts|tsx|mjs|js)$/.test(path) && !/\.spec\.tsx?$/.test(path),
    );

  it('**no `fetch(` outside the two fetchers**', () => {
    const sources = clientSources();
    // The floor: the scan reads the client at all.
    expect(sources.map(({ path }) => path)).toContain(
      'packages/api-client/src/browser-fetcher.ts',
    );

    const offenders = sources
      .filter(({ path }) => !FETCHERS.has(path))
      .filter(({ text }) => FETCH_CALL.test(stripComments(text)))
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it('the fetch scan sees a call and spares the generated mutator name', () => {
    expect(FETCH_CALL.test('await fetch(url, init)')).toBe(true);
    expect(FETCH_CALL.test('globalThis.fetch(url)')).toBe(true);
    expect(FETCH_CALL.test('return customFetch<T>(url, init)')).toBe(false);
    expect(FETCH_CALL.test('queryClient.prefetchQuery(options)')).toBe(false);
  });

  it('**the generated clients are never committed**, and git ignores them', () => {
    expect(repoFiles('packages/api-client/src/generated')).toEqual([]);

    // `check-ignore` exits 0 when the path is ignored, 1 when it isn't.
    expect(() =>
      execFileSync(
        'git',
        [
          'check-ignore',
          '-q',
          'packages/api-client/src/generated/rest/endpoints.ts',
        ],
        { cwd: REPO_ROOT },
      ),
    ).not.toThrow();
  });
});
