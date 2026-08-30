import { join } from 'node:path';

/**
 * @file Where this tool thinks it is.
 *
 * **One anchor, used by everything.** The databases were found relative to the
 * source file and the manifest relative to `process.cwd()`, so running from
 * anywhere but the repository root connected to the right three databases and
 * wrote the manifest somewhere else — `--only=ticket` from `scripts/` then
 * reported "No manifest … run the auth step first", which is a true sentence
 * about the wrong file.
 *
 * `.gitignore` hid the other half: `.demo-seed/` carries no leading slash, so
 * it matches at any depth and a stray `scripts/.demo-seed/` is ignored rather
 * than noticed.
 */

/** `scripts/seed-demo` → the repository root. */
export const REPO_ROOT = join(__dirname, '..', '..');
