#!/usr/bin/env node
/**
 * Checks the web's production build (run after `npm run build`): each route's
 * first-load JavaScript against `apps/web/bundle-budgets.json`, and the client
 * bundle for secrets. `scripts/lib/web-build-check.cjs` has the rules.
 *
 *   npm run check:web-build              # fails with the numbers
 *   npm run check:web-build -- --write   # resets every budget to today + 10%
 *
 * The credential names are the k8s generator's `SECRET` list (one list),
 * except `FIREBASE_API_KEY`, which the browser receives by design.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import checks from './lib/web-build-check.cjs';

const ROOT = join(import.meta.dirname, '..');
const WEB = join(ROOT, 'apps/web');
const BUDGETS = join(WEB, 'bundle-budgets.json');

const stats = JSON.parse(
  readFileSync(join(WEB, '.next/diagnostics/route-bundle-stats.json'), 'utf8'),
);

if (process.argv.includes('--write')) {
  writeFileSync(
    BUDGETS,
    JSON.stringify(checks.budgetsFrom(stats), null, 2) + '\n',
  );
  console.log(`Wrote ${stats.length} budgets to apps/web/bundle-budgets.json`);
  process.exit(0);
}

const generator = readFileSync(
  join(ROOT, 'scripts/generate-k8s-config.mjs'),
  'utf8',
);
const names = [
  ...(
    /const SECRET = new Set\(\[([\s\S]*?)\]\)/.exec(generator)?.[1] ?? ''
  ).matchAll(/'([A-Z0-9_]+)'/g),
]
  .map(([, name]) => name)
  .filter((name) => name !== 'FIREBASE_API_KEY');
if (names.length < 10) {
  console.error(
    `Read ${names.length} credential names from the k8s generator; expected at least 10.`,
  );
  process.exit(1);
}

const clientFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return clientFiles(path);
    return entry.name.endsWith('.js') ? [path] : [];
  });

const problems = [
  ...checks.overBudget(stats, JSON.parse(readFileSync(BUDGETS, 'utf8'))),
  ...clientFiles(join(WEB, '.next/static')).flatMap((file) =>
    checks
      .secretsIn(readFileSync(file, 'utf8'), names)
      .map((found) => `${file.slice(ROOT.length + 1)}: ${found}`),
  ),
];

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(
  `${stats.length} routes within budget; no secret in the client bundle.`,
);
