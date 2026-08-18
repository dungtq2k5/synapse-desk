# 0028 — The OpenAPI envelope is a per-route decorator, not a global wrapper

**Status:** accepted · **Code:** `apps/api-gateway/src/common/decorators/`

## Decision

`@ApiWrappedResponse` / `@ApiFilterErrors` per route. Not a global `ApiExtraModels` + generic wrapper.

## Why

- **The wrapping is not generic at the type level.** `TransformInterceptor` adds it at runtime and the handler signature never mentions it, so Swagger sees only the inner DTO. A decorator per route is the honest description of what actually happens, and it is one line.

## Consequences

- **Mark the exceptions, not the rule.** `@ApiCookieAuth` at the controller level, with a public marker on the ~10 genuinely public routes out of 184.
- The API has **four cookies, not one bearer token**, so the security schemes are named individually.
- **Turn the "every route has a summary" test on early**, while most routes are missing one: it becomes a live progress bar that cannot be gamed, rather than a test written at the end that passes on its first run and proves nothing.
