/**
 * Merges lcov reports into one, for Sonar.
 *
 * Sonar unions every report's `BRDA` entries by their `block,branch` key on
 * a line. That is right for reports Jest writes, which number a file's
 * branches the same way; the web suite's report numbers them its own way, so
 * a union would count one `if` twice. So reports come in two kinds:
 *
 * - `same` (Jest's): lines summed, branches unioned by key, as Sonar would.
 * - `other` (the web suite's): per line, hits summed, and the line's
 *   conditions are the larger of the two counts, covered the larger of the
 *   two covered counts (never more than the conditions).
 *
 * Paths are made relative to `root`, since CI's reports carry absolute ones.
 *
 * CommonJS so `scripts/jest.config.ts` can test it: ts-jest leaves `.mjs`
 * untransformed.
 */
const { isAbsolute, relative } = require('node:path');

/**
 * One report's files: line hits, and each line's branches by `block,branch`.
 *
 * @example parse('SF:a.ts\nDA:1,2\nBRDA:1,0,0,1\nend_of_record\n', '/repo')
 */
function parse(text, root) {
  const files = new Map();
  let file = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('SF:')) {
      const path = line.slice(3);
      const key = isAbsolute(path) ? relative(root, path) : path;
      file = files.get(key) ?? { lines: new Map(), branches: new Map() };
      files.set(key, file);
    } else if (line.startsWith('DA:') && file) {
      const [number, hits] = line.slice(3).split(',');
      const n = Number(number);
      file.lines.set(n, (file.lines.get(n) ?? 0) + Number(hits));
    } else if (line.startsWith('BRDA:') && file) {
      const [number, block, branch, taken] = line.slice(5).split(',');
      const n = Number(number);
      const arms = file.branches.get(n) ?? new Map();
      const count = taken === '-' ? 0 : Number(taken);
      arms.set(
        `${block},${branch}`,
        (arms.get(`${block},${branch}`) ?? 0) + count,
      );
      file.branches.set(n, arms);
    } else if (line === 'end_of_record') {
      file = null;
    }
  }
  return files;
}

/** Folds `from` into `into`, unioning branches by key. */
function union(into, from) {
  for (const [path, file] of from) {
    const target = into.get(path) ?? { lines: new Map(), branches: new Map() };
    for (const [n, hits] of file.lines) {
      target.lines.set(n, (target.lines.get(n) ?? 0) + hits);
    }
    for (const [n, arms] of file.branches) {
      const merged = target.branches.get(n) ?? new Map();
      for (const [key, taken] of arms) {
        merged.set(key, (merged.get(key) ?? 0) + taken);
      }
      target.branches.set(n, merged);
    }
    into.set(path, target);
  }
  return into;
}

/** A line's conditions as Sonar counts them: how many, how many taken. */
function conditions(arms) {
  let covered = 0;
  for (const taken of arms.values()) if (taken > 0) covered++;
  return { count: arms.size, covered };
}

/**
 * The merged report: `same` reports unioned, then each `other` folded in by
 * line.
 *
 * @example merge({ same: [jestText], other: [webText], root: '/repo' })
 */
function merge({ same, other, root }) {
  const base = new Map();
  for (const text of same) union(base, parse(text, root));
  const foreign = new Map();
  for (const text of other) union(foreign, parse(text, root));

  const out = [];
  const paths = new Set([...base.keys(), ...foreign.keys()]);
  for (const path of [...paths].sort()) {
    const a = base.get(path);
    const b = foreign.get(path);
    const lines = new Map(a?.lines);
    for (const [n, hits] of b?.lines ?? []) {
      lines.set(n, (lines.get(n) ?? 0) + hits);
    }
    const branchLines = new Set([
      ...(a?.branches.keys() ?? []),
      ...(b?.branches.keys() ?? []),
    ]);
    out.push(`SF:${path}`);
    for (const n of [...lines.keys()].sort((x, y) => x - y)) {
      out.push(`DA:${n},${lines.get(n)}`);
    }
    for (const n of [...branchLines].sort((x, y) => x - y)) {
      const own = conditions(a?.branches.get(n) ?? new Map());
      const theirs = conditions(b?.branches.get(n) ?? new Map());
      const count = Math.max(own.count, theirs.count);
      const covered = Math.min(count, Math.max(own.covered, theirs.covered));
      for (let arm = 0; arm < count; arm++) {
        out.push(`BRDA:${n},0,${arm},${arm < covered ? 1 : 0}`);
      }
    }
    out.push('end_of_record');
  }
  return `${out.join('\n')}\n`;
}

module.exports = { merge, parse };
