# 0032 — Breaking changes ship unversioned while no client exists — and are counted

**Status:** accepted · **Rule:** [development-conventions.md §6.1](../development-conventions.md)

## Decision

API versioning is not enabled. A breaking response-shape change is acceptable while no client has shipped — and each one is **recorded in the same place**, so the count is visible.

## Why

- Versioning a surface nobody consumes is cost without benefit.
- **The count is the signal.** A second such change is worth noticing rather than repeating silently; a third means the assumption "no client has shipped" has expired.

## Consequences

- The proto package is deliberately unversioned too, which makes `npm run proto:breaking` the **only** guard against a wire-incompatible deploy. Keep it in CI.
- **Where prose and code disagree and the code is right, the prose moves** — amend the spec in the same change, rather than leaving a row that makes a deliberately scoped endpoint look half-built.
