# 0049 — Every database gets its schema the way production does: a database check, `migrate deploy`, then `schema-apply`

**Status:** accepted · **Code:** `services/*/package.json` (`db:apply`), `docker/node-service.Dockerfile` (`migrate`), `packages/nest-common/src/utils/database-check.ts`, `scripts/reset-databases.mjs` · **Supersedes:** [ADR 0042](./0042-schema-reaches-production-through-migrate-deploy.md)

## Decision

**One schema script, `db:apply`, for every database:** production, development and test. Each schema-owning service runs three steps, in order, `&&`:

1. **The database check** (`src/database-check.ts`): refuse a database that doesn't exist (Postgres `3D000`), and one with tables but no `_prisma_migrations` (built by `db push`; the message names `npm run db:reset`);
2. **`prisma migrate deploy`:** the committed migrations, and nothing else;
3. **`node dist/src/schema-apply.js`:** the objects Prisma can't express (partial indexes, `CHECK`s, GIN, extensions; [ADR 0039](./0039-the-seeder-ddl-block-is-the-list.md)).

The production image's `migrate` stage runs the same three commands; `schema-contract.spec` holds `db:apply` equal to it.

- **Creating a database is `db:reset`'s job only** (`scripts/reset-databases.mjs`): it drops and creates each database and its shadow, then runs `db:apply`, and refuses any database not on this machine.
- **A shadow database per service** (`SHADOW_DATABASE_URL`, development and CI only) serves `db:migrate` (`scripts/new-migration.mjs`: the migrations replayed into the shadow database and diffed with the schema file, how a migration is written) and CI's drift check. **Not `prisma migrate dev`:** it compares the development database too, and reads the objects `schema-apply` adds as drift.
- **CI fails when the migrations and `schema.prisma` disagree** (`prisma migrate diff`, exit code 2).
- **`prisma db push` is in no script and no setup.** Run it by hand to try something; nothing else may.

## Why

- **The suites didn't test the database production runs.** `db push` built development and test databases from the schema file, never read the migrations, and (except through one script) skipped `schema-apply`. Measured: three of four services' development databases had none of their partial indexes, so the duplicate-event key and the one-open-group key weren't there while tests ran.
- **The migrations were never tested.** Nothing in CI ran `migrate deploy`: a schema change with no migration, or a broken one, passed every suite and would first have run in production.
- **ADR 0042's first reason doesn't hold:** it said `migrate deploy` never creates a database, so a typo'd production `DATABASE_URL` would fail the deploy. **Measured on Prisma 7.9.1, it creates one** and migrates it, and the service would start on an empty database. The refusal is now ours (step 1), in every environment.
- **Lost alternative:** keep `db push` for development (ADR 0042's split). It kept two paths, and the gap between them is exactly what the suites couldn't see.

## Consequences

- **Every schema change needs its migration before the suites pass** (`db:migrate`). Production needed it anyway; the failure moves from the deploy to CI.
- **`db:apply` runs the built `schema-apply.js`,** so build before setting up a database; CI builds the schema services first.
- **A database `db push` built** is refused by step 1; `npm run db:reset` rebuilds it once.
- **36 database scripts became 23**; the per-service shortcuts and `db:verify` are gone (`npm run db:apply -w @synapsedesk/<service>` does one service).
- [ADR 0042](./0042-schema-reaches-production-through-migrate-deploy.md)'s other reasons (migrations refuse an unexpected state, leave a history, need an operator when one fails halfway) stand, as do [ADR 0043](./0043-the-cluster-shape.md)'s init container and [ADR 0044](./0044-expand-and-contract-never-in-one-release.md)'s expand and contract.
