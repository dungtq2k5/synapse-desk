import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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
 * index after it was deleted or moved, and reading it would throw `ENOENT` from
 * inside the guard instead of failing an assertion. A guard that reads what it
 * lists uses {@link readRepoFiles} instead: this check runs at listing time, and
 * a file can still vanish before the read.
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

/** A listed file and its contents. */
export type RepoFile = { path: string; text: string };

/**
 * Reads repo-relative `paths`, dropping any that are gone by the time it reads.
 *
 * {@link repoFiles} drops a missing path when it lists, but `--others` lists
 * untracked files, and those come and go: editor temp files, a concurrent
 * process, a spec's own probe. One that is listed and then removed before the
 * read throws `ENOENT`, so that error means "no longer part of the corpus" and
 * the path is dropped. Any other error (a directory, a permission) is a real
 * failure and is thrown.
 *
 * @example readListed(repoFiles('*.md').filter(isDoc)) // [{ path: 'README.md', text: '…' }, …]
 */
export function readListed(paths: readonly string[]): RepoFile[] {
  return paths.flatMap((path) => {
    try {
      return [{ path, text: readFileSync(join(REPO_ROOT, path), 'utf8') }];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  });
}

/**
 * The repository's files matching `pathspecs`, listed as {@link repoFiles}
 * lists them, with their contents: the corpus for a guard that reads what it
 * lists. See {@link readListed} for why a listed file can be missing at read.
 *
 * @example readRepoFiles('.github/workflows/*.yml') // [{ path: '.github/workflows/ci.yml', text: '…' }, …]
 */
export function readRepoFiles(...pathspecs: string[]): RepoFile[] {
  return readListed(repoFiles(...pathspecs));
}
