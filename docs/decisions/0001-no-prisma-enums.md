# 0001 — Enumerated columns are `String`, never a Prisma `enum`

**Status:** accepted · **Rule:** [development-conventions.md §7.3](../development-conventions.md)

## Decision

No `enum` block in any `schema.prisma`. An enumerated column is `String @db.VarChar(50)`; the values live in `@synapsedesk/common` as a TypeScript enum, and the service layer constrains them.

## Why

- **It creates a third source of truth**: The value set already exists twice — as a TS enum in `libs/common` (which the services branch on) and as a numeric proto enum on the wire. A Postgres type makes three, and it's **totally useless**.
- **Database level mainly for storing not for validate**: Database is a place to store data, not to validate it. Validation should be done at the application level.

## Consequences

- Create an extra concern to gain nothing.
