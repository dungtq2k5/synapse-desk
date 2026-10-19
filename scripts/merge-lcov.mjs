#!/usr/bin/env node
/**
 * One lcov for Sonar from Jest's and the web suite's, merged as
 * `scripts/lib/lcov-merge.cjs` explains (the web suite numbers branches its
 * own way, so Sonar's union by key would count them twice).
 *
 *     node scripts/merge-lcov.mjs --out coverage-merged/lcov.info \
 *       --same coverage/lcov.info coverage-e2e/auth-service/lcov.info … \
 *       --other coverage-e2e/web/lcov.info
 *
 * Every named file must exist: a missing report would read in Sonar as
 * uncovered code, quietly.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

const { merge } = createRequire(import.meta.url)('./lib/lcov-merge.cjs');

const args = { same: [], other: [], out: null };
let into = null;
for (const arg of process.argv.slice(2)) {
  if (arg === '--same' || arg === '--other') into = arg.slice(2);
  else if (arg === '--out') into = 'out';
  else if (into === 'out') args.out = arg;
  else if (into) args[into].push(arg);
}
if (!args.out || args.same.length + args.other.length === 0) {
  console.error(
    'usage: merge-lcov.mjs --out <file> --same <lcov>… --other <lcov>…',
  );
  process.exit(2);
}

const read = (path) => readFileSync(path, 'utf8');
const merged = merge({
  same: args.same.map(read),
  other: args.other.map(read),
  root: process.cwd(),
});
mkdirSync(dirname(args.out), { recursive: true });
writeFileSync(args.out, merged);
console.log(
  `${args.out}: ${(merged.match(/^SF:/gm) ?? []).length} files from ${args.same.length + args.other.length} reports`,
);
