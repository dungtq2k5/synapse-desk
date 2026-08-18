# 0022 — Cross-service references have no FK; validate at write time over gRPC

**Status:** accepted · **Code:** `apps/ticket-service/`

## Decision

A reference to a row owned by another service is a plain id column with no foreign key. It is validated **at write time** via gRPC, never at read time.

## Why

- Each service owns its own database; an FK across that boundary does not exist to enforce.
- Validating on write means one check at the moment of intent, rather than a join on every read that could not be expressed anyway.

## Consequences

- Before creating a ticket, `ticket-service` confirms `author_id` resolves **in the caller's tenant** — a ticket cannot be authored by a user from another org.
- **Degrade deliberately, and not uniformly.** `listDepartments` returning empty on an unreachable `auth-service` is a good decision for classification: a convenience that degrades. The same decision applied to an **entitlement** read would be a disaster — a tenant whose budget cannot be fetched must not be treated as unlimited.
- Domain events get a typed discriminated-union contract; consumers `switch` on `pattern`, never on the raw NATS subject string.
