# 0021 — `is_email_verified` is a JWT claim, and the staleness is accepted

**Status:** accepted · **Code:** `EmailVerifiedGuard`

## Decision

`EmailVerifiedGuard` reads verification state from the token, so gating a route costs no round trip.

## Why

- The alternative is an `auth-service` call on every gated request, for a flag that changes once in an account's lifetime.

## Consequences

- **A user who just verified keeps the old claim until the token rotates**, which is why verification tells the client to call `POST /auth/refresh`.
- The guard belongs on business routes only — never on `/auth/*`, and **especially** never on the verification endpoints, which deadlocks the account permanently.
- **`GuestGuard` checks only the access token**, on the same reasoning in reverse: `refresh_token` is opaque and unverifiable at the gateway, and `device_token` deliberately outlives every session beside it. Treating either as "logged in" locks a user out of the login form they need to fix their state. It is a UX guard, not a security control — failing open is correct.
