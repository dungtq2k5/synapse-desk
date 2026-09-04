# 0042 — Schema reaches production through `prisma migrate deploy`

**Status:** accepted · **Mechanism lands with:** Phase 4 (a deploy needs somewhere to run) · **Code:** `apps/*/prisma/schema.prisma`, `apps/*/src/modules/prisma/database.seeder.ts` (`applySchemaObjects`)

## Decision

A production database gets its schema from **`prisma migrate deploy`**, run as a deploy step that completes before any replica serves traffic.

`prisma db push` remains the development answer, exactly as `development-conventions.md` §7 says: _"Schema is source of truth; reset freely."_ That sentence stays true where it was written and stops being the production answer, which it had become by default because nothing else was written down.

The twenty-four objects Prisma cannot express — partial indexes, `CHECK` constraints, composite GIN over a `tsvector`, extensions — keep their home in each service's `applySchemaObjects()`. They ran on every application boot when this was written and now run in the deploy step beside `migrate deploy` ([ADR 0043](./0043-the-cluster-shape.md)); either way they are one method, not migration SQL. Folding them into migration files is possible later and is not required by this decision.

## Why

`db push` has three properties that are fine in development and wrong in production, all measured:

1. **It creates a missing database on connect** rather than failing — `PostgreSQL database ci_probe_scratch_db created at localhost:5433`. A typo in a production `DATABASE_URL` does not stop the deploy; it provisions an empty database, and the service then boots against it.
2. **It refuses data-losing changes** without `--accept-data-loss`. A release that drops a column fails at the moment of deploy, with the previous version already stopped and no recorded way back.
3. **It leaves no history.** Nothing on the database records which schema it is at, so _"is this replica up to date"_ has no answer that does not involve reading the catalogue by hand.

`migrate deploy` answers all three: it refuses to run against an unexpected state, it records what has been applied, and it never creates a database as a side effect.

**The cost is real and worth naming.** The first migration must be baselined against databases that already exist; `development-conventions.md` §7 now differs between environments, which needs saying rather than assuming; and a migration that fails halfway still needs an operator. Phase 5 owns that last one — which is also the strongest argument against the alternative, because keeping `db push` has no answer to it at all.

## Why not keep `db push` in production

Nothing new to learn, and the dev and prod paths stay identical — genuinely the strongest argument for it. But identical paths are the problem rather than the benefit here: the three properties above are the same in both places and only harmful in one. A deploy that silently provisions an empty database on a typo is not a path worth keeping identical.

## What this does not decide

- ~~**Where the step runs.**~~ **Decided by [ADR 0043](./0043-the-cluster-shape.md): an `initContainer` on each Deployment that owns a Prisma schema.** The ordering constraint named here is exactly what the kubelet gives for free, and it was the hard part.
- ~~**Whether `applySchemaObjects()` moves.**~~ **It moved, in [ADR 0043](./0043-the-cluster-shape.md).** It runs in the same init container as `migrate deploy`, through `src/schema-apply.ts`, and no longer on every application boot. Splitting it out of the seeding gate — which this decision did — is what made that a move rather than a rewrite. What stays in the boot hook is `assertSchemaExists()`, so a pod booted against an unmigrated database refuses to serve instead of serving 500s.

## Consequences

- Migrations are generated and committed before the mechanism can be used; until then production has no supported schema path and that is now stated rather than implied.
- `SEED_ON_BOOTSTRAP` no longer means "skip the schema". It gates seed ROWS, exists only in auth-service, and is `required()` there — the three services that seed no rows do not declare it at all.
