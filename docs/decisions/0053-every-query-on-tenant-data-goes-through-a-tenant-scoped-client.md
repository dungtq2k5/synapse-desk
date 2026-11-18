# 0053 — Every query on tenant data goes through a tenant-scoped client

**Status:** accepted · **Code:** `packages/nest-common/src/utils/tenant-client.ts` (`TenantRule`, `UNSCOPED_REASONS`, `scopedArgs`), each service's `PrismaService` (`scoped`, `unscoped`), `packages/config/src/tenant-client.spec.ts` (the guard), each service's `tenant-probe.e2e-spec.ts`

## Decision

**A service reads and writes tenant data only through `prisma.scoped(context)`,** a Prisma `$extends` client bound to the caller's tenant. Every model has a rule, and the compiler refuses a model without one:

- `tenant`: the model has `organizationId`. Reads and bulk writes get it added to `where` (beside a unique field too, so `findUnique` is safe), and a create must name the caller's tenant; naming another throws.
- `tenantOrGlobal`: `organizationId` or NULL for rows every tenant shares (auth's system roles).
- `self`: the model is the tenant (`Organization`).
- `through`: a child table with no tenant column, scoped through its parent (`TicketMessage` through `ticket.organizationId`).
- `none`: not tenant data (catalogs, heartbeats, cursors).

A Super Admin gets no tenant filter. A background job working for one tenant uses that tenant's system context and is scoped like any caller. **Soft delete is not the client's job;** call sites keep `deletedAt: null` where they need it.

**The bare client is `prisma.unscoped(reason)`,** where `reason` comes from a closed list (`UNSCOPED_REASONS`: a cross-tenant job, the platform console, schema and seeding, a caller with no tenant yet, the caller's own account, the shared catalog, a globally unique key, a job by row id).

**A guard holds it** (`packages/config`): outside the files and functions it lists, it fails on a direct use of the bare client, an `unscoped(...)`, raw SQL, or a nested `connect`/`set` on a tenant relation. Raw SQL on a tenant table takes the organization id as a bound parameter.

**A probe proves it:** each Prisma service's e2e suite calls every id-taking RPC (listed from the proto files) as tenant B on tenant A's ids, and expects the answer for a missing id, no A rows in B's lists, and A's rows unchanged. The contract suite proves each gateway forwards the token's tenant and maps a peer's not-found to one 404.

## Why

- Scoping was by hand: a `requireTenant` plus a hand-written `where: { organizationId }` per query, or `tenantScope` on about a dozen. One forgotten filter was a cross-tenant leak, and nothing would have noticed. The first probe run found three reachable through the gateway and eight more reachable by a gRPC caller.
- A client bound per call fits how the code already passes the caller context, explicitly. It needs no request-scoped storage, and it costs 0.012 ms to build.

## Consequences

- **Postgres row-level security is the next layer, not this one.** It would cover raw SQL and rag-service's `asyncpg` reads too, at the cost of a transaction per query, a policy per table and a bypass role for every job. The scoped client makes it a contained step.
- **Child tables are scoped through a join.** Adding `organization_id` to them waits for RLS.
- **A new id-taking RPC joins the probe on its own,** because the list comes from the proto files and the probe's table must cover it.
- **Amended 2026-11-18: a scoped client doesn't refuse a Super Admin, so `requireTenant` stays as a check wherever it refused one.** Removing a `requireTenant` whose value looked unused opened the tenant webhook routes to a Super Admin in phase 2; it was restored before any push. Each probe now also calls every id-taking RPC as a Super Admin, against the outcome recorded before phase 2, so a change to what a Super Admin reaches through a tenant route fails a row. `tenantScope` is gone: each former use keeps `requireActor` (its identity check) and `deletedAt: null` (its soft-delete filter) explicitly. Whether `scoped()` should refuse a Super Admin by default is an open decision.
