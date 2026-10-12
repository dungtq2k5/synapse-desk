import { execFileSync } from 'node:child_process';
import { builtinModules } from 'node:module';
import { join } from 'node:path';
import { readRepoFiles, repoFiles } from '@synapsedesk/testing/repo-files';
import { stripComments } from '@synapsedesk/testing/strip-comments';
import { parseEnvFile } from '@synapsedesk/testing/env-file';

/**
 * The web client's boundaries, read from the files.
 *
 * - **No `fetch(` outside the two fetchers.** The browser fetcher holds the 401
 *   handling, the server fetcher holds `cache: 'no-store'`; a third caller of
 *   `fetch` would have neither.
 * - **The generated clients are never committed.** They're generated from the
 *   committed document before every build, so a committed copy could only drift.
 * - **Browser-safe.** The client imports nothing server-side; in the app, Node's
 *   built-ins only under `src/server/`, where the renderer's fetcher lives. That
 *   is what makes "the Next server calls only the gateway" checkable.
 * - **No colour literal**, and no raw primitive: a component's colour is a
 *   semantic token, which switches with the theme.
 * - **`apps/web/.env.example` declares only `GATEWAY_URL`.** The dev server
 *   proxies the socket too, so the browser needs no address of its own; and a
 *   `NEXT_PUBLIC_` variable is baked into the build, so none is wanted.
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

  // ------------------------------------------------------------ browser-safe

  const SERVER_ONLY_PACKAGE =
    /^(@synapsedesk\/(nest-common|grpc-proto|testing)(\/|$)|@nestjs\/|@grpc\/|ioredis$|nats$)/;
  const NODE_BUILTIN = (spec: string) =>
    spec.startsWith('node:') || builtinModules.includes(spec.split('/')[0]);

  const specifiers = (source: string): string[] =>
    [
      ...source.matchAll(
        /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g,
      ),
      ...source.matchAll(/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g),
      ...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
      ...source.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g),
    ].map((match) => match[1]);

  const browserSafeViolations = (path: string, source: string): string[] =>
    specifiers(stripComments(source))
      .filter(
        (spec) =>
          SERVER_ONLY_PACKAGE.test(spec) ||
          (NODE_BUILTIN(spec) && !path.startsWith('apps/web/src/server/')),
      )
      .map((spec) => `${path}: ${spec}`);

  it('**the client imports nothing server-side**; Node built-ins only in src/server/', () => {
    const sources = clientSources();
    expect(sources.some(({ path }) => path.startsWith('apps/web/src/'))).toBe(
      true,
    );

    expect(
      sources.flatMap(({ path, text }) => browserSafeViolations(path, text)),
    ).toEqual([]);
  });

  it('the import scan sees a server package and a misplaced built-in', () => {
    expect(
      browserSafeViolations(
        'apps/web/src/app/page.tsx',
        "import { x } from '@nestjs/common';",
      ),
    ).toHaveLength(1);
    expect(
      browserSafeViolations(
        'apps/web/src/app/page.tsx',
        "import { readFileSync } from 'node:fs';",
      ),
    ).toHaveLength(1);
    expect(
      browserSafeViolations(
        'apps/web/src/server/a.ts',
        "import { readFileSync } from 'node:fs';",
      ),
    ).toEqual([]);
  });

  // ------------------------------------------------------------ colours

  const COLOUR_LITERAL = [
    /(?<![\w&])#[0-9a-fA-F]{3,8}\b/, // only in CSS, below
    /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/,
    /\[#[0-9a-fA-F]{3,8}\]/, // a Tailwind arbitrary colour
    /['"`]#[0-9a-fA-F]{3,8}['"`]/, // a string that is only a hex colour
    /var\(--color-[a-z]+-\d{2,3}\)/, // a raw primitive
    // A Tailwind palette utility. The palette is reset, so it renders nothing.
    /(?<![\w-])(?:bg|text|border|ring|outline|fill|stroke|from|via|to|shadow|decoration|divide|placeholder|caret)-(?:white|black|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})\b/,
  ];

  const colourViolations = (path: string, source: string): string[] => {
    const code = stripComments(source);
    const patterns = path.endsWith('.css')
      ? COLOUR_LITERAL
      : COLOUR_LITERAL.slice(1);
    return patterns.filter((pattern) => pattern.test(code)).map(() => path);
  };

  it('**no colour literal and no raw primitive** in the web app', () => {
    const files = readRepoFiles('apps/web/src').filter(({ path }) =>
      /\.(ts|tsx|css)$/.test(path),
    );
    expect(files.map(({ path }) => path)).toContain(
      'apps/web/src/styles/globals.css',
    );

    expect([
      ...new Set(
        files.flatMap(({ path, text }) => colourViolations(path, text)),
      ),
    ]).toEqual([]);
  });

  it('the colour scan sees a literal and spares a ticket number', () => {
    expect(colourViolations('a.css', '.x { color: #006e75; }')).toHaveLength(1);
    expect(
      colourViolations('a.tsx', '<div className="bg-[#006e75]" />'),
    ).toHaveLength(1);
    expect(
      colourViolations('a.tsx', "style={{ color: 'rgb(0 0 0)' }}"),
    ).toHaveLength(1);
    expect(
      colourViolations('a.tsx', 'className="bg-[var(--color-teal-700)]"'),
    ).toHaveLength(1);
    expect(
      colourViolations('a.tsx', 'className="bg-black/50 text-white"'),
    ).toHaveLength(1);
    expect(colourViolations('a.tsx', 'className="text-teal-700"')).toHaveLength(
      1,
    );
    expect(colourViolations('a.tsx', '<span>Ticket #1042</span>')).toEqual([]);
    expect(
      colourViolations(
        'a.tsx',
        'className="bg-primary text-primary-foreground whitespace-nowrap -translate-x-1/2 bg-overlay"',
      ),
    ).toEqual([]);
  });

  // ------------------------------------------------------------ environment

  it('**apps/web/.env.example declares only GATEWAY_URL**', () => {
    const [example] = readRepoFiles('apps/web/.env.example');
    expect(example).toBeDefined();

    const keys = Object.keys(parseEnvFile(example.text));
    expect(keys).toContain('GATEWAY_URL');
    expect(keys.filter((key) => key !== 'GATEWAY_URL')).toEqual([]);
  });
});
