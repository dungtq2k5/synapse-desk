# 0003 — Background jobs run on BullMQ repeats, not `@Cron`

**Status:** accepted · **Rule:** [development-conventions.md §14](../development-conventions.md) (Background jobs)

## Decision

A job is a plain method taking an explicit window — no `@Cron`. Scheduling is a BullMQ repeat entry with a stable `jobId`, registered in `scheduler.module.ts`.

**A background job is not done when the method is written. It is done when something calls it, something records that it ran, and something complains when it stops.**

## Why

- **`@Cron` runs in-process**: N replicas fire it N times, and zero or N+1 under a rolling deploy. Idempotency makes that survivable, which is exactly why nobody would notice.
- **A schedule cannot be tested without waiting**: a plain method taking a window can be called directly by a test; a decorated one cannot.
- **A method with no caller looks finished in review**: seven jobs across two services were written correctly — idempotent, windowed, per-tenant-aware, each tested in isolation — and every one did nothing at all, because there was no scheduler. A job that never runs produces zeros rather than errors, and a zero is a valid answer to a valid query.

## Consequences

- Ordering constraints are **one job calling several in sequence**, never two cron entries minutes apart. The gap version works until the first job runs long, then destroys data the second had not read.
- `JobRunRecorder.track()` records each run; `last_succeeded_at` survives a failure because that is what the staleness check reads.
- Anything derived from a job carries a freshness field (`dataThrough`), so a dashboard of zeros says *why*.
- An end-to-end test must drive the scheduler **and** read the endpoint. Every other test passes against empty tables.

Code: `apps/*/src/modules/scheduler/`, `apps/*/src/modules/job-runs/`. Related: [0002](./0002-every-mocked-rpc-needs-an-owner-test.md).
