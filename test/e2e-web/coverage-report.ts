import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodedMap, FlattenMap } from '@jridgewell/trace-mapping';
import { parse } from '@babel/parser';
import { createInstrumenter } from 'istanbul-lib-instrument';
import { CoverageReport } from 'monocart-coverage-reports';
import { REPO_ROOT } from '../system/services';

/** A script's V8 coverage, as Chromium and NODE_V8_COVERAGE report it. */
type Entry = { url: string; functions: unknown[] };

/** The coverage build's output: the same chunks the browser and server ran. */
const NEXT_DIR = join(REPO_ROOT, 'apps/web/.next');

/**
 * A source as a repository-relative path, or null when it isn't one of the
 * repository's files. Browser maps name sources
 * `turbopack:///[project]/apps/web/src/x.tsx`; monocart hands server sources
 * over already relative; Next adds proxies (`x.tsx/__nextjs-internal-proxy…`)
 * that are no file at all. A package's `node_modules` and the build output are
 * not ours to report.
 */
function repoPath(source: string): string | null {
  const decoded = decodeURIComponent(source);
  const at = decoded.indexOf('[project]/');
  const path =
    at >= 0
      ? decoded.slice(at + '[project]/'.length)
      : relative(REPO_ROOT, resolve(REPO_ROOT, decoded));
  if (
    path.startsWith('..') ||
    path.includes('node_modules/') ||
    path.includes('.next/')
  ) {
    return null;
  }
  return existsSync(join(REPO_ROOT, path)) ? path : null;
}

/**
 * The chunk a coverage entry ran, in the build: a browser chunk by its URL
 * (`/_next/static/chunks/x.js`), a server chunk by its path in the standalone
 * copy (`.next/standalone/apps/web/.next/server/…`), whose maps stay in
 * `.next/server`.
 */
function chunkFor(url: string): string | null {
  if (url.startsWith('file://')) {
    const path = fileURLToPath(url);
    const at = path.indexOf('/.next/server/');
    return at < 0 ? null : join(NEXT_DIR, path.slice(at + '/.next/'.length));
  }
  const at = url.indexOf('/_next/static/');
  if (at < 0) return null;
  return join(NEXT_DIR, url.slice(at + '/_next/'.length).split('?')[0]);
}

/**
 * A chunk's source and its map, found through its `sourceMappingURL` (Turbopack
 * names a map by its own hash, not the chunk's) or beside it; null without one.
 */
function load(
  chunk: string,
): { source: string; sourceMap: { sourcemap: object } } | null {
  if (!existsSync(chunk)) return null;
  const source = readFileSync(chunk, 'utf8');
  const url = /\/\/# sourceMappingURL=(\S+)\s*$/.exec(source)?.[1];
  if (url?.startsWith('data:')) return null;
  // Some server chunks carry no comment, their map beside them.
  const mapPath = url
    ? join(dirname(chunk), decodeURIComponent(url))
    : `${chunk}.map`;
  if (!existsSync(mapPath)) return null;
  return {
    source,
    sourceMap: {
      sourcemap: flat(JSON.parse(readFileSync(mapPath, 'utf8')) as object),
    },
  };
}

/**
 * Turbopack writes the server's maps in sections, one per module, which
 * `v8-to-istanbul` can't read; flattened, they are ordinary maps.
 */
function flat(map: object): object {
  return 'sections' in map
    ? encodedMap(
        new FlattenMap(map as ConstructorParameters<typeof FlattenMap>[0]),
      )
    : map;
}

function* entries(dir: string): Generator<Entry> {
  const browser = join(dir, 'browser');
  if (existsSync(browser)) {
    for (const file of readdirSync(browser)) {
      yield* JSON.parse(readFileSync(join(browser, file), 'utf8')) as Entry[];
    }
  }
  const server = join(dir, 'server');
  if (existsSync(server)) {
    for (const file of readdirSync(server)) {
      if (!file.endsWith('.json')) continue;
      const { result } = JSON.parse(
        readFileSync(join(server, file), 'utf8'),
      ) as {
        result: Entry[];
      };
      yield* result.filter((entry) => entry.url.includes('/.next/server/'));
    }
  }
}

const instrumenter = createInstrumenter({
  esModules: true,
  parserPlugins: ['typescript', 'jsx', 'decorators-legacy'],
}) as {
  instrumentSync(code: string, filename: string): string;
  lastFileCoverage(): unknown;
};

type Position = { line: number; column: number };
type Location = { start: Position; end: Position };
type Shape = {
  statementMap: Record<string, Location>;
  branchMap: Record<
    string,
    { type: string; loc: Location; locations: Location[] }
  >;
};

const PARSER_PLUGINS = ['typescript', 'jsx', 'decorators-legacy'] as const;

/**
 * A source as Jest's lcov shapes it: its statements and branches as Istanbul
 * instruments them. Null when it doesn't parse.
 */
function shapeOf(path: string, source: string): Shape | null {
  try {
    instrumenter.instrumentSync(source, path);
  } catch {
    return null;
  }
  return instrumenter.lastFileCoverage() as Shape;
}

/**
 * Where each `if` statement's two arms start, by the statement's own start:
 * Istanbul gives both arms the statement's location, so they're read from
 * the syntax. `alternate` is null for an `if` with no `else`.
 */
function ifArms(
  source: string,
): Map<string, { consequent: number; alternate: number | null }> {
  const arms = new Map<
    string,
    { consequent: number; alternate: number | null }
  >();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const n = node as Record<string, unknown> & {
      type?: string;
      loc?: { start: Position };
      start?: number;
    };
    if (n.type === 'IfStatement' && n.loc) {
      const consequent = n.consequent as { start: number };
      const alternate = n.alternate as { start: number } | null;
      arms.set(`${n.loc.start.line}:${n.loc.start.column}`, {
        consequent: consequent.start,
        alternate: alternate ? alternate.start : null,
      });
    }
    for (const [key, value] of Object.entries(n)) {
      if (
        key !== 'loc' &&
        key !== 'leadingComments' &&
        key !== 'trailingComments'
      ) {
        visit(value);
      }
    }
  };
  try {
    visit(
      parse(source, {
        sourceType: 'module',
        plugins: [...PARSER_PLUGINS],
        errorRecovery: true,
      }).program,
    );
  } catch {
    // An unparsable source keeps no if-arms; its other branches still count.
  }
  return arms;
}

/** Source offsets of each line's start, for Istanbul's line/column. */
function lineStarts(source: string): number[] {
  const starts = [0, 0];
  for (
    let at = source.indexOf('\n');
    at >= 0;
    at = source.indexOf('\n', at + 1)
  ) {
    starts.push(at + 1);
  }
  return starts;
}

/**
 * How often V8 ran the code at a source offset: the count of the innermost
 * range around it, which is how V8's block coverage reads.
 */
function counter(ranges: { start: number; end: number; count: number }[]) {
  return (offset: number): number => {
    let best: { start: number; end: number; count: number } | null = null;
    for (const range of ranges) {
      if (range.start <= offset && offset < range.end) {
        if (!best || range.end - range.start < best.end - best.start)
          best = range;
      }
    }
    return best?.count ?? 0;
  };
}

type V8Files = {
  files: {
    sourcePath: string;
    data: {
      bytes: { start: number; end: number; count: number }[];
      // A partly run line is a string, "1/2".
      lines: Record<string, number | string>;
    };
  }[];
};

/**
 * The lcov a Sonar merge can line up with Jest's: Jest's shape (a `DA` per
 * statement line, a `BRDA` per Istanbul branch arm on the branch's line),
 * counted from V8's ranges.
 */
function writeLcov(dir: string): number {
  const v8 = JSON.parse(
    readFileSync(join(dir, 'report', 'coverage-report.json'), 'utf8'),
  ) as V8Files;
  const out: string[] = [];
  let files = 0;
  for (const { sourcePath, data } of v8.files) {
    const source = readFileSync(join(REPO_ROOT, sourcePath), 'utf8');
    const shape = shapeOf(sourcePath, source);
    if (!shape) continue;
    files++;
    const offsets = lineStarts(source);
    const at = (position: Position) => offsets[position.line] + position.column;
    const countAt = counter(data.bytes);
    out.push(`SF:${sourcePath}`);
    const lines = new Set(
      Object.values(shape.statementMap).map((loc) => loc.start.line),
    );
    for (const line of [...lines].sort((a, b) => a - b)) {
      const hits = data.lines[line] ?? 0;
      // Partly run is run, as Jest counts a statement that started.
      out.push(`DA:${line},${typeof hits === 'string' ? 1 : hits}`);
    }
    const ifs = ifArms(source);
    for (const [id, branch] of Object.entries(shape.branchMap)) {
      const line = branch.loc.start.line;
      let counts: number[];
      const arms = ifs.get(`${line}:${branch.loc.start.column}`);
      if (branch.type === 'if' && arms) {
        const consequent = countAt(arms.consequent);
        counts = [
          consequent,
          arms.alternate === null
            ? Math.max(0, countAt(at(branch.loc.start)) - consequent)
            : countAt(arms.alternate),
        ];
      } else {
        counts = branch.locations.map((loc) => countAt(at(loc.start)));
      }
      counts.forEach((count, arm) =>
        out.push(`BRDA:${line},${id},${arm},${count}`),
      );
    }
    out.push('end_of_record');
  }
  writeFileSync(join(dir, 'lcov.info'), `${out.join('\n')}\n`);
  return files;
}

/**
 * Turns the raw V8 coverage under `dir` (the browser's, from `coverage.ts`,
 * and the renderer's, from `NODE_V8_COVERAGE`) into `<dir>/lcov.info` over the
 * repository's sources: monocart merges each script's ranges and maps them
 * through its source map, with branches read from the source's syntax.
 * Returns the number of source files it covers.
 */
export async function writeWebCoverage(dir: string): Promise<number> {
  const report = new CoverageReport({
    name: 'web',
    outputDir: join(dir, 'report'),
    reports: ['v8-json'],
    cleanCache: true,
    sourceFilter: (source: string) => repoPath(source) !== null,
    sourcePath: (source: string) => repoPath(source) ?? source,
  });
  const sources = new Map<string, ReturnType<typeof load>>();
  const batch: object[] = [];
  const flush = async () => {
    if (batch.length > 0) await report.add(batch.splice(0));
  };
  for (const entry of entries(dir)) {
    const chunk = chunkFor(entry.url);
    if (!chunk) continue;
    if (!sources.has(chunk)) sources.set(chunk, load(chunk));
    const loaded = sources.get(chunk);
    if (!loaded) continue;
    batch.push({
      url: chunk,
      functions: entry.functions,
      source: loaded.source,
      sourceMap: loaded.sourceMap.sourcemap,
    });
    if (batch.length >= 200) await flush();
  }
  await flush();
  await report.generate();
  return writeLcov(dir);
}
