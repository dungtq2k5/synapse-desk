# 0013 — A batch RPC result maps from the requested keys, never from response order

**Status:** accepted · **Code:** `libs/grpc-proto/`, `apps/api-gateway/src/common/graphql/loaders/`

## Decision

```ts
// Mapped from the KEYS, never from the response.
return ids.map((id) => byId.get(id) ?? null);
```

## Why

- **The output is positional by construction.** A missing id becomes a null in the right slot rather than a shift in every slot after it — misattributing every subsequent row to the wrong entity.
- Build the mapping helper **before** the RPC: that is where the bug lives, it is testable with a stub in ten minutes, and writing it afterwards means writing it while thinking about the RPC instead of about the alignment.

## Consequences

- **Every DataLoader edge is nullable, for availability rather than for modelling.** A nulled `UserSummary` is a missing name; a nulled non-null field would take its parent with it, and the parent's parent.
- That is only safe because the GraphQL edge types are narrow — see [0014](./0014-narrow-graphql-edge-types.md).
- The loader key carries the tenant when the id alone does not disambiguate. For most reads the batch RPC is itself tenant-scoped, but that is a property of the RPC, so it is a contract rather than an assumption.
- Prefer a **flag over a second RPC** (`includeInactive`, defaulting false): one query, one tenant check, one place to get scoping wrong.
