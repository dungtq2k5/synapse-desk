import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * `check-pytest-skips.mjs` against a written JUnit report: which skips pass,
 * which fail, and what each prints.
 */
const GUARD = join(__dirname, 'check-pytest-skips.mjs');

const report = (skipMessages: string[]) => {
  const passed = Array.from(
    { length: 100 },
    (_, index) =>
      `<testcase classname="tests.t" name="test_${index}"></testcase>`,
  );
  const skipped = skipMessages.map(
    (message, index) =>
      `<testcase classname="tests.test_multimodal_e2e" name="test_live_${index}"><skipped type="pytest.skip" message="${message}"></skipped></testcase>`,
  );
  const path = join(mkdtempSync(join(tmpdir(), 'pytest-skips-')), 'pytest.xml');
  writeFileSync(
    path,
    `<testsuites><testsuite name="pytest" skipped="${skipped.length}">${[...passed, ...skipped].join('')}</testsuite></testsuites>`,
  );
  return path;
};

const run = (skipMessages: string[]) => {
  const result = spawnSync(process.execPath, [GUARD, report(skipMessages)], {
    encoding: 'utf8',
    env: { ...process.env, GEMINI_API_KEY: 'present' },
  });
  return { status: result.status, output: result.stdout + result.stderr };
};

describe('check-pytest-skips', () => {
  it('allows a provider that stayed busy, and prints it', () => {
    const { status, output } = run([
      'the provider stayed busy for three tries: 503 UNAVAILABLE',
    ]);

    expect(status).toBe(0);
    expect(output).toContain(
      'allowed skip (a responsive model provider absent): test_live_0',
    );
  });

  it('fails a used-up daily quota, saying the acceptance test did not run', () => {
    const { status, output } = run([
      "the Gemini key's daily quota is used up: 429 RESOURCE_EXHAUSTED GenerateRequestsPerDayPerProjectPerModel-FreeTier",
    ]);

    expect(status).toBe(1);
    expect(output).toContain(
      "test_live_0: the Gemini key's daily quota is used up — the acceptance test did not run",
    );
  });

  it('still fails a skip nobody registered', () => {
    const { status, output } = run(['some other reason']);

    expect(status).toBe(1);
    expect(output).toContain('unrecognized skip');
  });
});
