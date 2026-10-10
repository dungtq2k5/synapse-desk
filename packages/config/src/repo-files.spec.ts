import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, repoFiles } from '@synapsedesk/testing/repo-files';

/**
 * Every guard that reads the repository lists it through {@link repoFiles}, so
 * the one place that drops a listed-but-missing path covers all of them. A guard
 * that called `git ls-files` itself would bring back the `ENOENT` it fixes.
 */
describe('repoFiles is the only way a spec lists the repository', () => {
  const specs = (): string[] =>
    repoFiles(
      'services/**/*.spec.ts',
      'packages/**/*.spec.ts',
      'scripts/**/*.spec.ts',
    );

  it('finds the specs it is about — the pattern-fires floor', () => {
    expect(specs().length).toBeGreaterThan(50);
    expect(specs()).toContain('packages/config/src/ci-contract.spec.ts');
  });

  it('no spec runs `git ls-files` itself', () => {
    const offenders = specs().filter(
      (file) =>
        file !== 'packages/config/src/repo-files.spec.ts' &&
        /['"]ls-files['"]/.test(readFileSync(join(REPO_ROOT, file), 'utf8')),
    );

    expect(offenders).toEqual([]);
  });
});
