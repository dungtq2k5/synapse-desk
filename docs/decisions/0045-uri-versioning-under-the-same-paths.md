# 0045 — URI versioning is on, at `v1`, and no path moved to turn it on

**Status:** accepted · **Supersedes the mechanism half of:** [0032](./0032-unversioned-breaking-changes-are-counted.md) · **Code:** `apps/api-gateway/src/main.ts`, `apps/api-gateway/src/modules/health/ops-routes.ts`

## Decision

The gateway's global prefix is `api` — a prefix and nothing else — and the
version is Nest's URI versioning with `defaultVersion: '1'`. Every route
renders `/api/v1/…`, exactly as it did when the version was a substring of
the prefix. A breaking change to a route is made by `@Version('2')` on its
controller, serving both shapes side by side, not by counting.

The ops routes — `/health`, `/health/ready`, `/version` — are excluded from
the prefix **and** marked `VERSION_NEUTRAL`. The two are separate mechanisms
and a probe has to escape both.

## Why

- **The version was in the wrong place.** `GLOBAL_PREFIX = /api/v1` made `v1`
  a configuration string rather than a routing concept: a second version
  would have needed a second prefix, which is a second application. Nest's
  URI versioning renders the identical path from `api` + `1`, so the
  mechanism could arrive without a single client-visible address changing —
  which is why this is not counted under ADR 0032 and why it could be done
  before the first client rather than after.
- **The ADR 0032 count reached its own boundary.** That decision recorded
  breaking changes while no client existed and said a third meant the
  assumption had expired. The pre-client clearing recorded three at once and
  wrote the rule that the *next* one turns versioning on. Turning it on by
  decision — before that change — keeps the count honest: it stands at two
  clearings, and nothing after this is counted, because nothing after this
  needs to be.
- **The alternative that lost: header versioning.** It keeps paths static,
  which sounds like the same property — but it makes the version invisible in
  a URL, a log line, an ingress rule and a Stripe dashboard field, and every
  external caller here (Stripe, Resend) holds a *URL*.
- **The alternative that lost: leave it.** Cost nothing today and made the
  first `v2` a prefix change under every client at once.

## Consequences

- `GLOBAL_PREFIX` is `api` in every environment file and in the generated
  ConfigMap. The word, not a path.
- One `API_VERSIONING` options object, called from `main.ts` and both e2e
  bootstraps, pinned by a sweep — a bootstrap that forgets it is green in e2e
  and `404` in production.
- Swagger stays at `/api/v1/docs` and `/api/v1/docs-json`, built from the
  prefix and the default version — the `docs-json` URL generates client SDKs,
  and moving it would be the one path change this decision promises not to
  make. Whether docs go version-neutral is decided when a `v2` exists.
- **Two releases, not one** — measured: new code with the old value serves
  `/api/v1/v1/…` while readiness stays green, and a rollback restores the
  image but not the ConfigMap. Release 1 accepts both prefix forms with a
  deprecation `warn`; release 2 flips the value and tightens the Joi rule so
  a doubled version fails at boot. The same shape [ADR 0044](./0044-expand-and-contract-never-in-one-release.md)
  gives schema changes, for the same reason.
- The test helper `API` derives `/api/v1` from the prefix and the default
  version rather than holding the string.
- ADR 0032's rule about *counting* remains true of its era and is not
  edited; its sentence *"API versioning is not enabled"* is superseded by
  this decision. `docs/development-conventions.md` §5 (REST) gains the
  versioning rule: a breaking route change is a `@Version('2')`, never an
  edit in place.
