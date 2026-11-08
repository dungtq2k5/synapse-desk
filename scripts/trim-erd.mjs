#!/usr/bin/env node
/**
 * Strips trailing whitespace from a generated ERD, after `prisma generate`
 * writes it.
 *
 * `prisma-erd-generator` ends every attribute line without a comment in a
 * space, and an editor that trims on save (`.editorconfig` does) then changes
 * the file without changing the schema. Trimmed at the source, the file Turbo
 * caches, the one committed and the one an editor saves are the same file, so
 * `npm run check` leaves the tree clean.
 *
 * Usage, from a service's `db:generate`:
 *   prisma generate && node ../../scripts/trim-erd.mjs ../../docs/reference/erd/<service>.md
 */
import { readFileSync, writeFileSync } from 'node:fs';

for (const file of process.argv.slice(2)) {
  const text = readFileSync(file, 'utf8');
  const trimmed = text.replaceAll(/[ \t]+$/gm, '');
  if (trimmed !== text) writeFileSync(file, trimmed);
}
