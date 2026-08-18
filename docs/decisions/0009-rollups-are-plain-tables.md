# 0009 — Analytics rollups are plain tables written by idempotent jobs

**Status:** accepted · **Code:** `apps/*/src/modules/*/`*`rollup`*`.job.ts`

## Decision

Daily rollup tables, written by an idempotent job with a backfill entry point. Not materialized views, and not queries against raw rows.

## Why

- **Raw rows are retention-rolled.** `ai_generations` aggregates to daily per-(org, purpose, model) after ~90 days, so any analytics query written against raw rows silently loses history the moment retention ships.
- **Materialized views cannot be expressed in Prisma**, refresh whole rather than incrementally, and a `REFRESH` over a quarter is the same hot-path competition moved to a different hour.
- Plain tables are testable, backfillable and incremental.

## Consequences

- **Ship the backfill entry point on day one.** Fifteen minutes while the job is fresh; the alternative is a rollup bug with no way to recompute, so the metric stays wrong forever because the fix only applies going forward.
- The job recomputes a **trailing window** rather than only yesterday, which is what makes a single UTC schedule correct for tenants spanning timezones.
- Anything derived carries a freshness field so a dashboard of zeros says why. See [0003](./0003-bullmq-over-nest-cron.md).
