# 0029 — GraphQL caches entities, not responses, and the session key is never the token

**Status:** accepted · **Code:** `apps/api-gateway/src/common/graphql/loaders/`

## Decision

Cache behind the loaders, at entity granularity. Where response caching is used, `sessionId` is `user:{sub}` from the verified token — never the raw token.

## Why

- **Apollo serves a hit before NestJS guards run.** A `PRIVATE` entry is exactly as safe as its session key: if that key is the raw JWT, a token revoked five minutes ago still matches its own entry until the TTL expires, and the guard that would have rejected it never executes.
- `user:{sub}` is a *user* identity rather than a *credential*, so an entry survives exactly as long as its TTL — and it is stable across refresh, so rotation does not cold-start every entry.

## Consequences

- **The entity cache buys less per hit** — the resolver tree still runs, against cheaper data. That is the trade: a smaller win you can reason about instead of a larger one you apologise for.
- **Only entities behind narrow types are worth caching**, which is fortunate rather than coincidental: they are small, read constantly, and change rarely. A ticket is none of those.
- **No `user.*` invalidation event is needed.** The four fields behind `UserSummary` are written by exactly four gateway mutations; nothing else touches them.
