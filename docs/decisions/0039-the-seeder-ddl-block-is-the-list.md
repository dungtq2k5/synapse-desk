# 0039 — The seeder's DDL block is the list of hand-written SQL

**Status:** accepted · **Supersedes the enumeration in:** `development-conventions.md` §7 · **Code:** `apps/*/src/modules/prisma/database.seeder.ts`

## Decision

Schema stays the source of truth and ordinary changes stay in `schema.prisma`. Constraints and indexes Prisma cannot express live in the owning service's seeder DDL block, and **that block is the complete list**. No document enumerates them.

## Why

§7 named two exceptions — a `CHECK` on `users` and a partial unique index on `roles`. Both are auth-service, and by the time this was written the four seeders created **twenty-one** objects between them: partial unique indexes, composite GIN indexes over `tsvector`, array GIN indexes, an extension, and two `CHECK` constraints. auth-service, ingestion-service, notification-service and ticket-service all have a block.

Worse than incomplete: **one of the two it named was never applied.** known-gaps row 5 records that `CHECK ((organization_id IS NULL) = is_super_admin)` does not exist — the only `users` constraint in the auth seeder is `users_locked_until_requires_lock`, a different one. So the list was simultaneously missing nineteen entries and asserting one that was not there, and nothing detected either.

That is the structural argument, and it is not about diligence. A prose enumeration of database objects has no verifier: nothing fails when it drifts, and the drift is invisible at every call site. `CREATE UNIQUE INDEX IF NOT EXISTS` in a file that runs on every boot cannot drift from itself. Keeping the second copy only creates a way to be wrong.

## Consequences

- **§7 states the rule and points at the blocks.** It no longer lists objects, so it cannot go stale again.
- **known-gaps row 5 keeps its subject.** It is about a missing constraint, not about a stale list, and removing the list does not resolve it — if anything it sharpens it, because the seeder block is now the only place the constraint's absence can be read.
- **A new object is one edit, not two.** `ingestion_jobs_one_live_per_document` is the first added under this rule.
- **Reviewing "what raw SQL does this service have" is `grep executeRaw` in one directory**, which is a question the previous arrangement answered wrongly.
- **The cost is that no single page lists them all.** Accepted: a page that lists them all is exactly what was wrong, and per-service is the boundary that matters — a constraint belongs to the schema that owns it.
