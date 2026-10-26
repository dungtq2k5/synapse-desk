/**
 * Two checks on the web's production build, run in CI by
 * `scripts/check-web-build.mjs` after `npm run build`.
 *
 * - **Bundle budgets.** Each route's first-load JavaScript, uncompressed, as
 *   Next writes it to `.next/diagnostics/route-bundle-stats.json`
 *   (`firstLoadUncompressedJsBytes`), against `apps/web/bundle-budgets.json`.
 *   A route over its budget fails with both numbers; a route with no budget,
 *   or a budget naming no route, fails too, so the file stays complete.
 * - **Secrets in the client bundle.** Every `.js` file under `.next/static`
 *   (what the browser downloads), searched for the names of the variables that
 *   carry a credential and for the shapes of the credentials themselves.
 *
 * CommonJS so `scripts/jest.config.ts` can test it: ts-jest leaves `.mjs`
 * untransformed.
 */

/** Budgets are today's size plus this, rounded up to a KiB. */
const MARGIN = 0.1;

/**
 * What a route is allowed, from its measured size.
 *
 * @example budgetFor(1_000_000) // 1100800 (1.1 MB, rounded up to a KiB)
 */
function budgetFor(bytes) {
  return Math.ceil((bytes * (1 + MARGIN)) / 1024) * 1024;
}

/**
 * The routes that break a budget, as sentences; empty when every route fits.
 *
 * @param stats  `route-bundle-stats.json`'s entries
 * @param budgets route → bytes
 */
function overBudget(stats, budgets) {
  const measured = new Map(
    stats.map((entry) => [entry.route, entry.firstLoadUncompressedJsBytes]),
  );
  const problems = [];
  for (const [route, bytes] of measured) {
    if (!(route in budgets)) {
      problems.push(
        `${route}: ${bytes} bytes and no budget (add one: npm run check:web-build -- --write)`,
      );
    } else if (bytes > budgets[route]) {
      problems.push(
        `${route}: ${bytes} bytes of first-load JavaScript, over its budget of ${budgets[route]} by ${bytes - budgets[route]}`,
      );
    }
  }
  for (const route of Object.keys(budgets)) {
    if (!measured.has(route)) {
      problems.push(`${route}: a budget for a route the build no longer has`);
    }
  }
  return problems;
}

/** Budgets for every measured route, sorted by route. */
function budgetsFrom(stats) {
  return Object.fromEntries(
    [...stats]
      .sort((a, b) => a.route.localeCompare(b.route))
      .map((entry) => [
        entry.route,
        budgetFor(entry.firstLoadUncompressedJsBytes),
      ]),
  );
}

/** A credential's shape: anything matching is a secret in the bundle. */
const SECRET_SHAPES = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk_(?:live|test)_[A-Za-z0-9]{16,}/,
  /\brk_(?:live|test)_[A-Za-z0-9]{16,}/,
  /\bwhsec_[A-Za-z0-9+/]{16,}/,
  /\bre_[A-Za-z0-9]{8}_[A-Za-z0-9]{16,}/,
  // A URL's user holds no `:`, `@` or `/`, and its password no `@` or `/`:
  // classes that overlap backtrack on a long run without `@`.
  /postgres(?:ql)?:\/\/[^\s"'`:@/]+:[^\s"'`@/]+@/,
  /redis:\/\/[^\s"'`:@/]*:[^\s"'`@/]+@/,
];

/**
 * Where a client file gives a secret away: a credential variable's name, or a
 * credential's shape. Empty when it gives nothing away.
 *
 * @param text  one client `.js` file
 * @param names the variables that carry a credential
 */
function secretsIn(text, names) {
  return [
    ...names.filter((name) => new RegExp(`\\b${name}\\b`).test(text)),
    ...SECRET_SHAPES.filter((shape) => shape.test(text)).map(String),
  ];
}

module.exports = { budgetFor, budgetsFrom, overBudget, secretsIn };
