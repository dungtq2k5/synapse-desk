# Known Gaps — Read Before You Trip Over Them

**Current state.** Real, current, and they bite silently. Each row names the file that proves it. Verify before trusting; delete the row when you close it.

| # | Gap | Where | Consequence |
| :---- | :---- | :---- | :---- |
| 1 | **Tenant scoping is applied by hand.** `tenantScope()` is the shared helper and is used across services, but there is **no Prisma middleware or `$extends`** — nothing forces a query to call it. | `libs/common/src/utils/tenant-scope.ts` | A forgotten `...tenantScope(ctx)` is a cross-tenant data leak, not a bug. **`findUnique({ where: { id } })` cannot express the filter at all** — always `findFirst` + scope, and let a miss be `NOT_FOUND`, never `PERMISSION_DENIED`. |
| 2 | **`otps.code_hash` and `two_factor_backup_codes.code_hash` use SHA-256** where a slow KDF is the better fit (§8.1). Both columns are already `VarChar(255)` to accommodate one. | `apps/auth-service/src/modules/otp/otp.service.ts` (`hashToken(code)`), `apps/auth-service/src/common/utils/crypto.ts` | A 6-digit code is ~20 bits — offline-guessable if the table leaks. `maxAttempts` + short expiry are the online defence today. |
