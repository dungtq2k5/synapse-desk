# 0014 — Narrow GraphQL edge types, not field guards

**Status:** accepted · **Code:** `apps/api-gateway/src/modules/*/dto/graphql/`

## Decision

An edge exposes a narrow type carrying only what every caller may see. Field guards are the exception for genuinely conditional fields (an internal note's body, a document's departments), not the mechanism holding the model up.

## Why

- Permission composition over a wide type means every field is a potential leak, and the guard set grows with the product.
- Cost limits and the auth decorator are built **before the first resolver**: both are cheap now and expensive to retrofit, and they constrain a surface nobody uses yet rather than restricting one clients already depend on.

## Consequences

- **`schema.gql` is committed** with `sortSchema: true`, so a breaking schema change is a reviewable diff rather than a client failing in staging.
- **`@Field()` always names its GraphQL type explicitly** — `() => ID`, `() => Int`. TypeScript's `number` cannot distinguish `Int` from `Float`, nor `string` an `ID` from a `String`, and both serialise identically until a client generates types from the SDL.
- `nullable` mirrors the REST DTO's `| null`, enforced by the contract spec (§12.2) rather than by inheritance.
- A read belongs in GraphQL when its rows carry entity ids something can traverse to; several analytics reads deliberately have no GraphQL query for that reason.
