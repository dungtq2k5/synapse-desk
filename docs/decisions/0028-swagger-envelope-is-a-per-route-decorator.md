# 0028 — The OpenAPI envelope is a per-route decorator, not a global wrapper

**Status:** accepted · **Code:** `services/api-gateway/src/main/java/com/synapsedesk/gateway/common/openapi/` (`ApiErrors.java`, `ErrorEnvelopeOperationCustomizer.java`)

## Decision

The success envelope is in each handler's return type, `ApiResponse<T>`, and the errors a route can answer are declared on that route with `@ApiErrors`. Not one error list applied to every route.

## Why

- **Each route's document is read off the route itself.** The envelope is in the return type, so the schema springdoc publishes is the one the handler returns, and `ErrorEnvelopeOperationCustomizer` turns each route's `@ApiErrors` into its published error responses. One annotation per route is the honest description of what that route does, and it is one line.

## Consequences

- **Mark the exceptions, not the rule.** Routes are cookie-authenticated unless `@RouteSecurity` marks them otherwise, and the same annotation both publishes and enforces it.
- The API has **four cookies, not one bearer token**, so the security schemes are named individually.
- **Turn the "every route has a summary" test on early**, while most routes are missing one: it becomes a live progress bar that cannot be gamed, rather than a test written at the end that passes on its first run and proves nothing.
- **The document is a tracked file, and CI fails when it drifts.** `OpenApiDocumentExportIT` saves the document the gateway serves at `/v3/api-docs` from a real Spring context, `scripts/export-openapi.mjs` writes it to `docs/reference/openapi.json` Prettier-formatted and validated against OpenAPI 3.1, and `openapi:check` compares the two byte for byte. Nothing is reordered: the committed file is exactly what a client fetching the document reads.
