import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** The repository root, from this file's place in it. */
export const REPO_ROOT = join(__dirname, '../../..');

/**
 * The repository's files matching `pathspecs`, repo-relative: the corpus every
 * guard that reads the repository builds from.
 *
 * `--others` includes files not yet committed, so a guard covers a new file
 * before the commit that adds it, not after. `--exclude-standard` keeps out what
 * `.gitignore` names: `dist`, `node_modules`, generated clients.
 *
 * A listed path that no longer exists is dropped. Git lists a file still in the
 * index after it was deleted or moved, and an untracked file can vanish between
 * the listing and the read; either one read later would throw `ENOENT` from inside
 * the guard instead of failing an assertion.
 *
 * @example repoFiles('.github/workflows/*.yml') // ['.github/workflows/ci.yml', …]
 */
export function repoFiles(...pathspecs: string[]): string[] {
  return execFileSync(
    'git',
    [
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '--',
      ...pathspecs,
    ],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  )
    .split('\n')
    .filter(Boolean)
    .filter((file) => existsSync(join(REPO_ROOT, file)));
}
