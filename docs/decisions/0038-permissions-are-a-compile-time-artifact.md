# 0038 — Permissions are a compile-time artifact, not data

**Status:** accepted · **Code:** `libs/common/src/configs/rbac.config.ts`

## Decision

`PERMISSION_CODES` is the single source of truth for what a permission is. The `permissions` table is a projection of it, seeded at boot. **There is no route that creates one**, at tenant or platform level, and there should not be.

## Why

- **A permission is a union member, not a row.** `PermissionCode` is `(typeof PERMISSION_CODES)[number]`, so `@RequirePermission('x')` is a compile error unless `x` is in the array. That is what makes the guard matrix checkable at all — a permission the compiler has never seen cannot appear on a route.
- **The row exists to be joined, not to be authoritative.** `_role_permissions` needs something to point at; the table is that and nothing more.
- **A runtime-created code would be inert.** No route could require it, no guard could enforce it, and `assertGrantable` refuses to grant any code outside the array — `INVALID_ARGUMENT`, *"Unknown permission code(s)"*. It would be a permission that exists, appears in the role editor, and does nothing. Worse than absent, because absent is legible.
- **A new permission ships with a deploy**, and the four-place edit that entails — `PERMISSION_CODES`, `PERMISSION_NAMES`, `SYSTEM_ROLE_PERMISSIONS`, the endpoints plan — is recorded in `development-conventions.md` §5.4.

## Consequences

- **`GET /platform/permissions` and `POST /platform/permissions` are not built**, and their rows in the plan are struck with the reason kept rather than deleted. A struck row answers "why isn't there one?"; a deleted row invites the question again.
- **`GET /permissions` already serves every caller who could want it.** `listPermissions()` takes no `CallerContext` — the catalogue is global, so there is no tenant filter to fail on — and `PermissionGuard` returns early for a Super Admin, so `role.read` is not a barrier to one.
- **Codes RETIRE even though they never mutate.** A code removed from the array is deliberately left in the table, because tenant custom roles may still reference it and dropping the row would cascade that grant away silently. So the table can legitimately hold rows the union does not, and the catalogue must say which: `PermissionResponse.is_retired` is derived from `PERMISSION_CODES` at read time, never stored.
- **Superseding this ADR means explaining how a guard enforces a code the compiler has never seen.** That is the question, and it is not answered by making the table writable.
