# 0010 — A readiness probe never gates on a peer

**Status:** accepted · **Code:** `apps/*/src/modules/ops/`

## Decision

`/health/ready` answers one question: *should traffic reach this instance?* Peer state belongs in the response body, never in the status code.

## Why

- **Cascading readiness turns one outage into a total one.** If the gateway reports unready because a peer is down, the load balancer pulls the gateway too — and every route that did not need that peer dies with it.
- **Even the strongest case fails.** A gateway arguably cannot work without `auth-service` — but JWTs verify locally against the public key, so a brief outage leaves existing sessions working. Pulling the gateway would end them.

## Consequences

- `/version` is read from the environment, **baked at build time**, and the build fails if the ARG is empty. A container has no `.git`, so a runtime `git rev-parse` returns nothing and the natural fallback is `"unknown"` — the answer you get at exactly the moment you need the real one.
- `/version` is served from **every** service. A rolling deploy where one service lagged is precisely the state this diagnoses, and a gateway-only endpoint cannot see it.
- `/metrics` binds a **separate internal listener**, not a route on the public app. A metrics endpoint reachable from the internet is an inventory of your traffic, error rates and queue depths.
