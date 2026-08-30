/**
 * @file Types for `database-url.mjs`, so TypeScript callers get the same checking
 * everything else here gets.
 *
 * A declaration file rather than a rewrite: `db:verify` and `db:reset` are
 * plain Node scripts and there is no reason to convert them, but the demo
 * seeder is TypeScript and re-deriving `isLocalDatabase` there would be a
 * second copy of the one check standing between a script and a production
 * database.
 */

/** Reads `DATABASE_URL` out of an `.env` file, or `undefined` if absent. */
export function readDatabaseUrl(fileUrl: URL): string | undefined;

/** Whether a connection string points at this machine. */
export function isLocalDatabase(url: string): boolean;

/** Hides the password, for a line about to be printed. */
export function redact(url: string): string;
