# 0020 — Email uniqueness is per-tenant, enforced twice

**Status:** accepted · **Code:** `applyPartialIndexes()` in `apps/auth-service/src/modules/prisma/database.seeder.ts`

## Decision

Two partial unique indexes — one for tenant users, one for Super Admins — plus a service-layer check.

## Why

- **Postgres does not treat NULLs as equal**, so a Super Admin (`organization_id IS NULL`) escapes the tenant index and needs its own guard.
- **The service check does not replace the index.** A `findFirst`-then-`create` is a race that a double-clicked submit button wins. The index makes the duplicate impossible; the check exists so the 99.99% non-racing case gets *"That address already has an account here"* instead of a raw constraint error.
- **Both indexes live in the seeder, not a one-off `psql`.** `db push --force-reset` would otherwise drop them silently and leave a schema that *looks* correct with the constraint gone.

## Consequences

- Every unique field on a soft-deletable table follows the same split (§7.2). Soft-delete releases the partial index, so restoring into a hash another row now holds must return 409, not 500.
