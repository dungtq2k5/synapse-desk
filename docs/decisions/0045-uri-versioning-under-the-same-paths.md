# 0045 — URI versioning is on, at `v1`, and no path moved to turn it on

**Status:** accepted · **Supersedes the mechanism half of:** [0032](./0032-unversioned-breaking-changes-are-counted.md) · **Code:** `apps/api-gateway/src/main/java/com/synapsedesk/gateway/web/ApiPaths.java`, `apps/api-gateway/src/main/java/com/synapsedesk/gateway/ops/OpsController.java`

## Decision

The gateway's global prefix is `api` — a prefix and nothing else — and the version is a segment of its own, `v1`: every controller route is built from the one constant `ApiPaths.V1`, so every route renders `/api/v1/…`. A breaking change to a route serves a second version beside the first, both shapes side by side, not by counting. **The mechanism for that second version does not exist yet** — there is no per-route version selection, only the constant — and it is built with the first route that needs it, not before.

The ops routes — `/health`, `/health/ready`, `/version` — are mapped without `ApiPaths.V1`, so they carry neither the prefix nor a version.

## Why

- **The version was in the wrong place.** `GLOBAL_PREFIX = /api/v1` made `v1` a configuration string rather than a routing concept: a second version would have needed a second prefix, which is a second application. A version segment of its own renders the identical path, so it could arrive without a single client-visible address changing — which is why this is not counted under ADR 0032 and why it could be done before the first client rather than after.
- **The ADR 0032 count reached its own boundary.** That decision recorded breaking changes while no client existed and said a third meant the assumption had expired. The pre-client clearing recorded three at once and wrote the rule that the *next* one turns versioning on. Turning it on by decision — before that change — keeps the count honest: it stands at two clearings, and nothing after this is counted, because nothing after this needs to be.
- **The alternative that lost: header versioning.** It keeps paths static, which sounds like the same property — but it makes the version invisible in a URL, a log line, an ingress rule and a Stripe dashboard field, and every external caller here (Stripe, Resend) holds a *URL*.
- **The alternative that lost: leave it.** Cost nothing today and made the first `v2` a prefix change under every client at once.

## Consequences

- `GLOBAL_PREFIX` is `api` in every environment file and in the generated ConfigMap. The word, not a path.
- The served document is at `/v3/api-docs`, outside the version; the tracked copy is `docs/reference/openapi.json`, and that is the one client SDKs generate from.
- ADR 0032's rule about *counting* remains true of its era and is not edited; its sentence *"API versioning is not enabled"* is superseded by this decision. `docs/development-conventions.md` §5 (REST) gains the versioning rule: a breaking route change is a second version, never an edit in place.
