# 0044 — Expand and contract, never in one release

**Status:** accepted · **Code:** `apps/*/prisma/migrations/`, `libs/common/src/configs/schema-contract.spec.ts` · **Follows:** [ADR 0042](./0042-schema-reaches-production-through-migrate-deploy.md), [ADR 0043](./0043-the-cluster-shape.md)

## Decision

A schema change that removes or narrows anything ships in a **different
release** from the code change that stops relying on it.

- **Expand first.** Add the column, the table, the nullable field. Deploy it.
  The old code ignores it; the new code can use it.
- **Contract later.** Drop the column, add the `NOT NULL`, tighten the
  constraint — in a release *after* the one where nothing reads it any more.
- **A rename is four steps across two releases**: add the new column, copy,
  switch the code, drop the old one.

Concretely, a migration may not do both halves at once, and a release may not
pair a contracting migration with the code change that made it possible.

## Why

**Prisma does not generate down-migrations.** There is no `migrate down`, and
`prisma migrate diff --from-schema --to-migrations` produces SQL a human still
has to read and decide about. So the schema has no automatic reverse, and the
only rollback this system has is the code one: `kubectl rollout undo`, which
restores a pod spec ([ADR 0043](./0043-the-cluster-shape.md) is what makes that
restore a real image rather than a moving `:latest` pointer).

A code rollback is only safe when **the previous image's expectations are a
subset of the current schema**. Expand-then-contract is exactly the discipline
that keeps that true: at every moment, the database satisfies both the release
that is running and the one before it.

Pair the two halves in one release and the property inverts. The new migration
drops a column; the new code no longer selects it; the deploy goes bad for an
unrelated reason; `rollout undo` restores an image that selects a column that no
longer exists. **The rollback is now the outage** — and it happens during an
incident, which is the only time anyone reaches for it.

## What this costs, honestly

Two deploys for one logical change, and a window in which the schema carries
something nothing uses. That window is the price of the rollback being real, and
it is small compared with the alternative: a bad release that cannot be undone
without writing SQL under time pressure.

It also means a contracting migration is written against a schema state the
author must reason about rather than read — "is anything still selecting this?"
is a question about the *previous* release, not the current tree.

## What it does not cover

- **The twenty-four objects Prisma cannot express.** They are applied by
  `applySchemaObjects()` from `src/schema-apply.ts`
  ([ADR 0039](./0039-the-seeder-ddl-block-is-the-list.md),
  [ADR 0043](./0043-the-cluster-shape.md)) and are `CREATE … IF NOT EXISTS`
  throughout, so they only ever expand. Removing one is a code change to the
  seeder plus a hand-written `DROP` in a migration, and that `DROP` is a
  contraction like any other.
- **Data backfills.** A copy step in a rename is data movement, and a large one
  belongs in a job rather than in a migration that holds a lock while it runs.
  This decision says where the steps go, not how long they may take.

## Consequences

- **`0_init` is exempt and is the only exemption.** It creates everything and
  removes nothing, against a database that has no previous release.
- **`development-conventions.md` §7 now differs from itself by environment**, and
  says so: *"Schema is source of truth; reset freely"* remains the development
  answer, and it is the sentence this decision does not apply to. A developer
  resetting a local database has no rollback to protect.
- **A reviewer has something to check.** "Does this migration drop, narrow or
  rename?" and "does the same PR stop using it?" are two questions with one
  correct pair of answers, and they are answerable from the diff alone.
