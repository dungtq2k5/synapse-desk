/**
 * @file Reading a service's `DATABASE_URL` out of its `.env`, for the scripts
 * that act on databases directly.
 *
 * Shared rather than copied: `db:verify` and `db:reset` both need it, and the
 * regex below is not the obvious one — a second copy would be a second chance
 * to write `\s` where it matters.
 */

import { readFileSync } from 'node:fs';

/**
 * One `DATABASE_URL = …` assignment, anywhere in the file.
 *
 * **`[ \t]` rather than `\s`, and that is the point rather than a tidy-up.**
 * `\s` matches a NEWLINE, so in multiline mode `^\s*` can run past the start of
 * its own line and then backtrack across the whole file — super-linear on input
 * read from disk. Restricting the runs to horizontal whitespace makes every
 * quantifier here linear and non-overlapping.
 *
 * The capture excludes `"`, so a closing quote can never be part of it and no
 * trailing `"?` is needed to strip one.
 */
const DATABASE_URL_LINE = /^[ \t]*DATABASE_URL[ \t]*=[ \t]*"?([^"\n]*)/m;

/**
 * @param fileUrl a `URL` pointing at the `.env` to read.
 * @returns the URL, or `undefined` when the file or the variable is absent —
 *   which the caller reports rather than guessing at.
 */
export function readDatabaseUrl(fileUrl) {
  let text;

  try {
    text = readFileSync(fileUrl, 'utf8');
  } catch {
    return undefined;
  }

  // `exec`, not `match`: with a non-global regex the two return the same shape,
  // and `exec` is the one that does not change meaning if `g` is ever added.
  const match = DATABASE_URL_LINE.exec(text);

  return match?.[1]?.trim();
}

/**
 * Whether a connection string points at this machine.
 *
 * The guard on every destructive script here. Matched on the HOST between `@`
 * and the port, so a database named `localhost_backup` on a remote server does
 * not read as local.
 */
export function isLocalDatabase(url) {
  return /@(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)[:/]/.test(url);
}

/** Hides the password, for a line that is about to be printed. */
export function redact(url) {
  return url.replace(/:[^:@/]*@/, ':***@');
}
