# 0031 — The gateway defines narrow DTOs; it never republishes a proto type

**Status:** accepted · **Code:** `apps/api-gateway/src/modules/tickets/`

## Decision

`DraftCitationDto` carries the four fields `ticket-service` actually sends — `chunkId`, `documentId`, `documentTitle`, `pageNumber` — not what `rag-service` produces.

## Why

- **A DTO wider than its source is a promise nothing fills.** The vector point id is an internal retrieval identifier that the draft path deliberately drops on the way through; publishing it would leak an internal id and describe a field that is always absent.
- **The gateway is exactly the boundary no test crosses**, which is why defects there appear at both ends at once rather than one — each service satisfies its own contract.

## Consequences

- **`pageNumber` is `optional int32` on the wire, so the DTO field is `number | null`** with the mapper choosing. Typing it `number` makes the CLI plugin publish a required field that is sometimes absent — a lie in the spec rather than in the code.
- The realtime path still leaks the vector id and should not. Same shape of fix, **separate change on a different surface** — bundling it would mix a REST fix with a WebSocket contract change.
