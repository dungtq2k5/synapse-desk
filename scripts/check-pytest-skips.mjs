#!/usr/bin/env node
/**
 * A skipped test that nobody notices is a test that stopped running.
 *
 * **The vacuity class, arriving through a skip rather than a bad assertion.**
 * `test_multimodal_e2e.py` is the acceptance test for attachments — the
 * attachment build order says the feature is finished when it passes — and it
 * is gated on `GEMINI_API_KEY` *and* on `poppler_available()`. A runner
 * holding the secret and no `poppler-utils` skips exactly as silently as one
 * holding neither, and `pytest -q` reports a cheerful green either way. So a
 * "did we supply the key" check is not the control: it passes on the runner
 * that skips for the other reason.
 *
 * The rule this enforces instead:
 *
 *   - a skip whose reason is not in `EXPECTED` fails, always — that is a test
 *     silently leaving the suite;
 *   - and when the environment CAN run a gated test, skipping it fails too.
 *     Measured on a fully provisioned machine: 515 passed, 0 skipped. So zero
 *     is the floor whenever the gate's precondition is present, and the
 *     allowance only opens for the specific thing that is genuinely absent.
 *
 *     node scripts/check-pytest-skips.mjs apps/rag-service/pytest.xml
 */

import { readFileSync } from 'node:fs';

/**
 * Skips this repo accepts, each with the condition that makes it legitimate.
 *
 * Named, never pattern-matched — the `TWINLESS` shape used by every other
 * registry in this repo, so an unexplained skip cannot dress itself up as an
 * expected one.
 */
const EXPECTED = [
  {
    match: /cheap-tier call/i,
    // Secrets are not exposed to pull requests from forks, so this skip is
    // honest there and a failure anywhere the key exists.
    legitimateWhen: () => !process.env.GEMINI_API_KEY,
    absent: 'GEMINI_API_KEY',
  },
  {
    match: /pdftoppm|poppler/i,
    // The python job installs poppler-utils precisely so this never fires;
    // if it does, the install step regressed rather than a decision changed.
    legitimateWhen: () => false,
    absent: 'poppler-utils (the python job installs it — this is a regression)',
  },
];

const [reportPath] = process.argv.slice(2);

if (!reportPath) {
  console.error('usage: check-pytest-skips.mjs <junit-xml>');
  process.exit(2);
}

let xml;
try {
  xml = readFileSync(reportPath, 'utf8');
} catch {
  // A missing report is itself a failure: it means the suite did not run to
  // completion, which is exactly the state this guard exists to make loud.
  console.error(`no pytest report at ${reportPath} — did the suite run?`);
  process.exit(1);
}

const cases = [...xml.matchAll(/<testcase\b[^>]*>/g)].length;
const skipped = [
  ...xml.matchAll(
    /<testcase\b[^>]*?name="([^"]*)"[^>]*>\s*<skipped[^>]*message="([^"]*)"/g,
  ),
].map(([, name, message]) => ({ name, message }));

// **The floor for a check whose good state is ZERO.** A skipped count cannot
// have a lower bound the way every other scan in this repo does — zero skips
// is what success looks like — so "found nothing" and "parsed nothing" are the
// same number, and the `cases` floor below is on the other regex entirely.
// JUnit declares the count on the suite element, so parser and report can be
// made to agree: a skip format this parser cannot read becomes a loud
// disagreement instead of a quiet zero.
//
// Measured before this existed: a report declaring `skipped="1"`, whose reason
// was element text rather than a `message` attribute, came back
// `515 test cases, 0 skipped` and exit 0 — the check written to make a silent
// skip loud, skipping silently. Same shape as the `redis-cli` absence recorded
// in known gap #7: a tool that cannot see something reports the same value as
// a world with nothing to see.
//
// Summed rather than taken from the first match, because pytest wraps its one
// `<testsuite>` in `<testsuites>` and other runners nest several.
const declaredSkips = [
  ...xml.matchAll(/<testsuite\b[^>]*\bskipped="(\d+)"/g),
].reduce((total, [, count]) => total + Number(count), 0);

if (declaredSkips !== skipped.length) {
  console.error(
    `report declares ${declaredSkips} skipped, parser found ${skipped.length} — ` +
      'the skip format moved and this check is reading past it',
  );
  process.exit(1);
}

// Corpus floor: a report with no test cases parsed means the format moved or
// the run collapsed, and every assertion below would be vacuously satisfied.
if (cases < 100) {
  console.error(
    `only ${cases} test cases in ${reportPath} — report looks wrong`,
  );
  process.exit(1);
}

console.log(`${cases} test cases, ${skipped.length} skipped`);

const problems = [];

for (const { name, message } of skipped) {
  const expected = EXPECTED.find((entry) => entry.match.test(message));

  if (!expected) {
    problems.push(`${name}: unrecognised skip — "${message}"`);
    continue;
  }

  if (!expected.legitimateWhen()) {
    problems.push(
      `${name}: skipped although its precondition is available — ${expected.absent}`,
    );
    continue;
  }

  // Visible, deliberately: the skip is acceptable and must still be READ, or
  // "we did not run the acceptance test" quietly becomes "green".
  console.log(`  allowed skip (${expected.absent} absent): ${name}`);
}

if (problems.length) {
  console.error('\nskips that are not accounted for:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
