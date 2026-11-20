/**
 * @jest-environment node
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every row takes `test` from `coverage.ts`. One that imports it from
 * `@playwright/test` still runs and passes, and silently records no
 * coverage, so the web lines it reaches read as uncovered in Sonar.
 */
describe('the rows record coverage', () => {
  const rows = ['.', 'screens'].flatMap((dir) =>
    readdirSync(join(__dirname, dir))
      .filter((file) => file.endsWith('.e2e-spec.ts'))
      .map((file) => join(dir, file)),
  );

  it('finds the rows', () => {
    expect(rows.length).toBeGreaterThan(20);
  });

  it.each(rows)('%s takes `test` from coverage.ts', (row) => {
    const source = readFileSync(join(__dirname, row), 'utf8');
    const playwright = /import\s*\{([^}]*)\}\s*from\s*'@playwright\/test'/.exec(
      source,
    );
    expect(playwright?.[1] ?? '').not.toMatch(/\btest\b/);
    if (/\btest\(|\btest\.describe\b/.test(source)) {
      expect(source).toMatch(
        /import\s*\{[^}]*\btest\b[^}]*\}\s*from\s*'\.\.?\/coverage'/,
      );
    }
  });
});
