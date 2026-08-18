# 0027 — The lock state matrix is enforced by a CHECK, and one state is deliberately unsupported

**Status:** accepted · **Code:** `users.is_locked`, `users.locked_until`

## Decision

A CHECK constraint makes the invalid rows of the lock state matrix **unrepresentable**, not merely unwritten. `isLocked` is authoritative; `lockedUntil` is only an expiry, acted on by two mechanisms.

## Why

- A state that is merely "never written" gets written eventually, by a path nobody checked.

## Consequences

- **A scheduled *future* lock is deliberately not supported.** `is_locked = false` with a future `locked_until` reads like *"lock this account on Monday"* — a plausible feature, and not this one. It needs its own column (`locked_from`) and its own sweep. Leaving the state invalid is what stops someone half-implementing it by setting two fields.
- Any comment describing `lockedUntil` as a temporal filter is **actively misleading** once the column exists, and must be rewritten rather than left — the next reader will otherwise believe the filter is temporal when it is not.
