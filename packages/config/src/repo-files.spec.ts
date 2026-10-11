import { readListed, repoFiles } from '@synapsedesk/testing/repo-files';

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
    const offenders = readListed(
      specs().filter(
        (file) => file !== 'packages/config/src/repo-files.spec.ts',
      ),
    )
      .filter(({ text }) => /['"]ls-files['"]/.test(text))
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
  });
});

/**
 * The reading step on its own, given lists a race would produce, so the test
 * does not depend on timing: a guard's corpus can lose a file between the
 * listing and the read, and that must not throw.
 */
describe('readListed', () => {
  const PRESENT = 'packages/config/src/repo-files.spec.ts';

  it('drops a listed path that is gone by the time it reads', () => {
    const read = readListed([PRESENT, 'packages/config/src/vanished.ts']);

    expect(read.map(({ path }) => path)).toEqual([PRESENT]);
    expect(read[0].text).toContain("describe('readListed'");
  });

  it('throws any other read error — a directory is not a vanished file', () => {
    expect(() => readListed([PRESENT, 'packages/config/src'])).toThrow(
      /EISDIR/,
    );
  });
});
