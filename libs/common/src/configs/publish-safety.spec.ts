import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * No workspace can be published, and every manifest names the same licence.
 *
 * **`private` is the entire mechanism, and it was set on two workspaces out of
 * nine.** `npm publish --workspaces` reads that field and nothing else — no
 * allow-list, no confirmation beyond the registry auth. Measured before the
 * fix, on this repository:
 *
 * ```
 * npm warn publish Skipping workspace @synapsedesk/rag-service, marked as private
 * npm warn publish Skipping workspace @synapsedesk/storage-service, marked as private
 * npm warn This command requires you to be logged in to https://registry.npmjs.org/
 * npm notice Publishing to https://registry.npmjs.org/ with tag latest and default access
 * ```
 *
 * Two skipped, seven straight through to the auth check — so one `npm login`
 * away from publishing this backend to the public registry. The tarball is not
 * a token surface either: auth-service's carries `.env.test`, the whole of
 * `prisma/` including migrations, and every `src/` file. **npm's unpublish
 * window is time-limited**, so that is a mistake with no clean undo, which is
 * what makes a guard worth more here than a habit.
 *
 * **The state it replaced read like someone started and stopped** — which is
 * exactly the shape that survives review, because two correct examples make the
 * absence elsewhere look intentional.
 *
 * Scanned from the TREE toward the rule, so workspace number ten is covered on
 * arrival rather than when somebody remembers this file.
 */
describe('nothing here can be published, and the licence is one string', () => {
  const REPO_ROOT = join(__dirname, '../../../..');

  /**
   * The SPDX identifier for what `LICENSE` actually grants.
   *
   * `-only` rather than `-or-later` because the README grants "version 3" and
   * does NOT add "or any later version" — test 3 pins that, since the suffix is
   * a consequence of the wording rather than a preference. Bare `AGPL-3.0` is
   * DEPRECATED in the SPDX list (verified against
   * `spdx/license-list-data`), and npm validates none of the three: a typo here
   * is accepted silently and only a scanner ever notices.
   */
  const LICENSE = 'AGPL-3.0-only';

  const read = (repoRelative: string): string =>
    readFileSync(join(REPO_ROOT, repoRelative), 'utf8');

  /**
   * Every tracked manifest — the root, both workspace globs, and the package
   * that is deliberately outside them.
   *
   * `*` in a git pathspec is plain fnmatch and CROSSES `/`, so the
   * `*\/package.json` pathspec below reaches every depth (escaped here only
   * because an unescaped one would CLOSE this comment); `package.json` alone is
   * the root. `scripts/` is NOT an npm workspace, so `--workspaces` cannot
   * publish it — it is in the corpus anyway, because `npm publish` run from
   * inside it still can.
   */
  const manifests = (): string[] =>
    execFileSync('git', ['ls-files', '--', 'package.json', '*/package.json'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean);

  const parse = (file: string): Record<string, unknown> =>
    JSON.parse(read(file)) as Record<string, unknown>;

  it('**1. every manifest is `private: true`**', () => {
    const publishable = manifests()
      .filter((file) => parse(file).private !== true)
      .map((file) => `${file}: private=${String(parse(file).private)}`);

    expect(publishable).toEqual([]);
  });

  it('**2. every manifest names the same licence**', () => {
    // One string, so `npm ls --json`, GitHub's dependency graph and any
    // scanner that walks workspaces per-package all report the same answer.
    // A manifest with no `license` is reported as UNLICENSED, which for an
    // AGPL project is the opposite of what it says on the tin.
    const wrong = manifests()
      .filter((file) => parse(file).license !== LICENSE)
      .map((file) => `${file}: license=${String(parse(file).license)}`);

    expect(wrong).toEqual([]);
  });

  it('**2b. …including the Python half**', () => {
    // **The one manifest in this repository that is not a `package.json`.**
    // rag-service is Python, so it is invisible to every check above — and a
    // licence that is uniform across nine workspaces and silent on the tenth
    // service is the same started-and-stopped shape as the `private` field
    // this file exists for, one toolchain over.
    //
    // A `.toml` read with a regex rather than a parser, deliberately: adding a
    // TOML dependency to `libs/common` so one string can be asserted would cost
    // more than it buys, and the pattern-fires floor below is what keeps the
    // shortcut honest. `pyproject.toml` is found from git, so a second Python
    // package is covered on arrival rather than by editing this test.
    const pyprojects = execFileSync(
      'git',
      ['ls-files', '--', '*pyproject.toml'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean);

    // The floor: a glob that matched nothing would report a compliant tree.
    expect(pyprojects).toContain('apps/rag-service/pyproject.toml');

    const wrong = pyprojects
      .map((file) => ({
        file,
        // PEP 639's bare SPDX string. The deprecated PEP 621 table form
        // (`license = { text = "…" }`) deliberately does NOT match — it would
        // be a finding, not a pass.
        declared: /^license\s*=\s*"([^"]*)"/m.exec(read(file))?.[1],
      }))
      .filter(({ declared }) => declared !== LICENSE)
      .map(({ file, declared }) => `${file}: license=${String(declared)}`);

    expect(wrong).toEqual([]);
  });

  it('**3. …and that identifier matches what the project actually grants**', () => {
    // The tether. `-only` is not a style choice: it is what "version 3" with
    // no "or any later version" means, so if the grant is ever widened this
    // fails and says the manifests must follow.
    const license = read('LICENSE');
    const readme = read('README.md');

    expect(license).toContain('GNU AFFERO GENERAL PUBLIC LICENSE');
    expect(license).toContain('Version 3');

    // The README's own grant, not the copy of the FSF's boilerplate inside
    // LICENSE — which quotes "or any later version" while explaining the
    // clause, and would make a naive search on the whole file useless.
    const grant = /## License\n([\s\S]*?)(?=\n## |$)/.exec(readme)?.[1] ?? '';

    expect(grant).toContain('version 3');
    expect(grant).not.toContain('or any later version');
    expect(LICENSE).toBe('AGPL-3.0-only');
  });

  it('**4. the scan reaches every workspace, not an empty list**', () => {
    // A pathspec that matched nothing would report a compliant tree. The floor
    // is derived from the declared globs rather than hard-coded, so a third
    // workspace glob cannot slip past the corpus itself.
    const globs = (parse('package.json').workspaces ?? []) as string[];
    const found = manifests();

    expect(globs.length).toBeGreaterThan(0);

    for (const glob of globs) {
      const directory = glob.replace(/\/\*$/, '');

      expect([
        directory,
        found.some((file) => file.startsWith(`${directory}/`)),
      ]).toEqual([directory, true]);
    }

    expect(found).toContain('package.json');
    // Outside the workspace globs, so the scan reaching it proves the corpus is
    // not derived from them.
    expect(found).toContain('scripts/package.json');
    expect(found.length).toBeGreaterThanOrEqual(10);
  });
});
