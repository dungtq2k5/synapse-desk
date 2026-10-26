/**
 * The side-effect-free half of `scripts/new-migration.mjs`: the name it
 * accepts, the folder it writes, and whether a diff has anything to write.
 * CommonJS so the scripts' jest can load it (ts-jest leaves `.mjs` as is).
 */

'use strict';

const { basename, resolve, sep } = require('node:path');

/** A migration's name: snake_case, so it is always one folder. */
const NAME = /^[a-z][a-z0-9_]*$/;

/**
 * Whether a `prisma migrate diff --script` output changes anything. Its
 * statements start a line; `[ \t]*`, not `\s*`, because in multiline mode
 * `\s` crosses newlines and backtracks over the whole diff.
 */
const STATEMENT = /^[ \t]*(CREATE|ALTER|DROP|COMMENT)\b/im;

/**
 * The folder a migration named `name` is written to:
 * `<cwd>/prisma/migrations/<YYYYMMDDHHMMSS>_<name>`. Throws on a name that
 * isn't snake_case, and on a folder outside `prisma/migrations` (which the
 * name's pattern already rules out).
 *
 * @example migrationFolder('add_widget_color') // …/prisma/migrations/20261026103000_add_widget_color
 */
function migrationFolder(name, now = new Date(), cwd = process.cwd()) {
  if (typeof name !== 'string' || !NAME.test(name)) {
    throw new Error(
      'Name the migration in snake_case: npm run db:migrate -- add_widget_color',
    );
  }
  const stamp = now.toISOString().replace(/\D/g, '').slice(0, 14);
  const migrations = resolve(cwd, 'prisma/migrations');
  const folder = resolve(migrations, basename(`${stamp}_${name}`));
  if (!folder.startsWith(migrations + sep)) {
    throw new Error(`${folder} is outside ${migrations}.`);
  }
  return folder;
}

/** Whether `sql`, a `prisma migrate diff --script` output, changes anything. */
function hasChanges(sql) {
  return STATEMENT.test(sql);
}

module.exports = { migrationFolder, hasChanges };
