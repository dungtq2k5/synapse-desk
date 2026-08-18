# 0002 — Every mocked RPC needs an owner test

**Status:** accepted · **Rule:** [development-conventions.md §13.5b](../development-conventions.md)

## Decision

The service that **owns** an RPC tests it against the real database, even when every caller mocks it. A scheduled job with no test is the same bug with a worse failure mode.

## Why

**A cross-service RPC that all of its consumers mock is executed by nothing.** The mocks agree with each other forever, the suite is green, and the implementation is never run.

This is not hypothetical. `listPermissionHolders` and `listUsersByIds` — the two resolvers that decide who receives a notification — both filtered on `lockedUntil`, **a column that does not exist**. Every call threw a Prisma validation error, so no notification audience in the product could ever have been resolved. Three notification-service suites mocked them, auth-service had no test for either, and it shipped green through two domains.

Note what did *not* catch it: `tsc`. A Prisma `where` naming a nonexistent column is normally an excess-property error, but an object literal containing a **conditional spread** — `...(x ? { y } : {})`, which is how every optional filter in this codebase is written — suppresses that check. So the compiler cannot be relied on here; only executing the query can.

## Consequences

- Mocking an RPC at the call site stays correct — a fan-out test should be about fan-out. The obligation is on the owning service, not the caller.
- A job that never runs produces zeros rather than errors, and a zero is a valid answer to a valid query. See [0003](./0003-bullmq-over-nest-cron.md).
