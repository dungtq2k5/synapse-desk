# API Endpoint Plan — SynapseDesk

**Scope:** every HTTP endpoint the `api-gateway` (BFF) must expose, plus the gRPC methods and NATS/WebSocket events each one is backed by.

**Global prefix:** `api/v1` (set in [main.ts](../apps/api-gateway/src/main.ts)) — paths below omit it.

---

## 0. Conventions

### 0.1 Request scoping (non-negotiable)

Per RDM §1.1, every authenticated request carries a JWT with `user_id`, `organization_id`, `is_super_admin`, and the user's `department_ids`. A gateway guard resolves this into a `RequestContext` (`libs/common/src/context/`) and it is forwarded on every gRPC call as metadata. **No endpoint accepts `organizationId` as a client-supplied parameter** — the only exceptions are the `/platform/*` Super Admin routes, where the tenant is an explicit path segment.

### 0.2 Auth column legend

| Marker | Meaning |
| :---- | :---- |
| `PUBLIC` | No token required |
| `USER` | Any authenticated tenant user |
| `SELF` | Authenticated user acting on their own record |
| `perm:code` | Requires the `permissions.code` shown (RBAC via `_user_roles` ➔ `_role_permissions`) |
| `SUPER` | `users.is_super_admin = true` (`organization_id IS NULL`) |

### 0.3 Standard shapes

- **List endpoints:** `?page=1&limit=20&sort=-createdAt&q=<search>` → `{ data: [], meta: { page, limit, total, totalPages } }`. Soft-deleted rows excluded unless `?includeDeleted=true` (requires the matching `*.manage` permission).
- **Deletes:** `DELETE` performs a **soft delete** (sets `deleted_at` / `deleted_by_id`) on `organizations`, `departments`, `users`, `documents`, `tickets`. Hard delete is never exposed over HTTP.
- **Restore:** soft-deletable resources get `POST /<resource>/:id/restore`.
- **Errors:** RFC7807-ish `{ statusCode, code, message, details? }`. `GlobalRpcExceptionFilter` maps gRPC status → HTTP status.
- **Idempotency:** mutating AI/billing-relevant endpoints (`POST /tickets/:id/messages`, document upload) accept an `Idempotency-Key` header.
- **Audit:** every non-GET endpoint marked ✎ writes an `audit_logs` row (action name given in the *Audit action* notes under each domain).

### 0.4 Tenant lifecycle gate

A global interceptor checks `organizations.status` (RDM §1.8) before dispatch:

| Status | Allowed |
| :---- | :---- |
| `PENDING_ONBOARDING` | auth + `/onboarding/*` only |
| `ACTIVE` | everything |
| `SUSPENDED_PAST_DUE` | `GET` only + auth + billing |
| `FROZEN` | auth only (403 on all business routes) |

**`status` is written by Stripe, not by hand, once billing is live** (RDM §1.15). The enum was designed before billing existed and maps onto Stripe's subscription statuses unchanged — `active|trialing → ACTIVE`, `past_due|unpaid → SUSPENDED_PAST_DUE`, `canceled|incomplete_expired → FROZEN` — so this gate is the enforcement mechanism that was already built for it. `POST /platform/organizations/:id/status` remains, for platform-initiated `FROZEN` (compliance hold) which has no Stripe equivalent.

### 0.5 Quota gates

| Endpoint group | Checked against |
| :---- | :---- |
| `POST /users/invitations`, `POST /users` | `organizations.max_agent_seats` vs **active agents + outstanding `PENDING` invitations**. Counting only active agents would let an admin issue 50 invites against 10 seats and blow the quota on acceptance. Re-checked at `POST /users/invitations/:token/accept` — **409** if the tenant filled up in the interim. Expired invitations release their reservation automatically (RDM §1.8, Table 28). |
| `POST /documents` | `organizations.max_storage_bytes` vs `SUM(documents.file_size_bytes)` |
| **Every AI surface** — `POST /chat/conversations/:id/messages`, `POST /tickets/:id/ai/*`, greeting Layer 2, query reformulation, ingestion embeddings | `monthly_ai_token_budget` vs spend summed from **`ai_generations` (RDM Table 29)** since `billing_cycle_start` — **not** `ticket_messages`, which only sees chat answers and is blind to drafts, summaries, classifications and embeddings. Runtime check is a Redis counter (`quota:{org}:{cycle}`), reconciled against the ledger; the `SUM` is the definition, not the hot-path query. **The counter increment is synchronous and awaited; only the durable ledger row is fire-and-forget** — an asynchronous increment lets a burst of concurrent requests all read the same stale value and all pass the gate (RDM §1.14). See RDM §1.14 for the per-surface behaviour at cap, which differs by surface and is summarized below. |

**At the cap, surfaces behave differently — and one of them is a product decision, not an error code:**

| Surface | Behaviour |
| :---- | :---- |
| `POST /tickets/:id/ai/draft`, `/classify`, `/suggestions` | **402.** The agent works manually. Clean. |
| `POST /tickets/:id/ai/summary` — manual | **402.** Discretionary. |
| `/ai/summary` — auto-invoked on escalation | **Allowed inside a bounded 10% grace**, then 402. See the compounding note below. |
| `POST /chat/conversations/:id/messages` | **Persist the message, then auto-escalate** to `organizations.default_department_id` and tell the user a human will respond. Returning "AI unavailable" would leave the question unanswered — worse than a slower answer. |
| Greeting detection, Layer 2 | **Stops** (it is an LLM call). Regex-only; unmatched → treated as factual → escalation path above. The greeting *reply* is a canned lookup, not a generation, so it is unaffected at any budget. |
| `POST /knowledge/search` | **200 with `degraded: "LEXICAL_ONLY"`** — the FTS arm costs nothing, so corpus diagnostics survive the cap. |
| `POST /knowledge/ask` | **402.** Retrieval could degrade; the answer cannot. |
| Ingestion embeddings | `ingestion_jobs` stay **`QUEUED`**, resumed at cycle roll. Not failed — a tenant who overspent on chat should not also lose document onboarding, and failing discards work already done. |

**Every 402 above travels as `PERMISSION_DENIED` with an `[http:402]` marker**, which the gateway's exception filter strips and obeys — without it the cap surfaces as **403** and sends an admin hunting role grants for a billing problem (`http-status-hint.ts`). **Every route that can return it declares it** — `POST /knowledge/ask` and the four generating `/tickets/:id/ai/*` routes. `GET /tickets/:id/ai/summary` does not, and should not: it reads a stored row and spends nothing. A generating route added later must carry `'402'` in its `@ApiFilterErrors`, or the spec will describe its billing refusal as a permissions failure.

**Two failures compound at the cap.** Deflection stops, so ticket volume spikes 3–5× — and every one of those tickets arrives without an AI summary, because summaries are an AI surface too. Agents get several times the work with none of the context that makes them fast. Hence the grace row: an escalation summary is the cheapest call the system makes and is worth most exactly when the queue floods. Bounded at 10%, because an unbounded exemption is not a cap.

**Threshold alerts** fire at **80% / 95% / 100%** to holders of `organization.update`, using `notifications.event_id = "quota:{orgId}:{cycleStartEpoch}:{threshold}"` — `UNIQUE (recipient_id, event_id)` makes each threshold fire exactly once per cycle, and putting the cycle in the key means `POST /platform/organizations/:id/billing-cycle/reset` re-arms them with no extra bookkeeping. 100% uses `priority = CRITICAL` to bypass quiet hours. **The 80% message must state the operational consequence** — *"at 100%, all self-service questions will route to your agents"* — because at a 70–80% deflection rate, hitting the cap is a 3–5× spike in agent queue volume, not a billing footnote.

---

## 1. Domain A — Auth, Identity & Access (`auth-service`)

### 1.1 Authentication — `/auth`

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| POST | `/auth/register` | Sign up. Auto-joins a tenant when the email domain matches `organizations.allowed_email_domains`/`domain`; otherwise creates a `PENDING_ONBOARDING` org. The "already registered" check is scoped to the **tenant being joined**, not global (RDM §1.10) — the same address may legitimately hold an account in another tenant. | PUBLIC |
| POST | `/auth/login` | Email + password. Returns tokens; **or** `{ requiresTwoFactor: true, twoFactorToken }` when `is_two_factor_enabled` (or `enforce_two_factor`) and the request carries no device-trust cookie matching a live `device_token_hash` with `trusted_until > NOW()`; **or** `{ requiresTenantSelection: true, tenantSelectionToken, tenants[] }` when the address resolves to accounts in more than one tenant (RDM §1.10). Every candidate row is password-checked even after a match, so response time does not leak how many tenants an address belongs to. | PUBLIC |
| POST | `/auth/login/tenant` | Exchange `tenantSelectionToken` + `{ organizationId }` for tokens. **401** if `organizationId` is outside the token's verified candidate set. The 2FA challenge is evaluated *after* this step, since `enforce_two_factor` is per-tenant. The tenant list is only ever emitted after a password has verified, so this pair never becomes an unauthenticated "which tenants own this address?" oracle. | PUBLIC |
| POST | `/auth/refresh` | Rotate the refresh token. Looks the presented token up by `refresh_token_hash`, stamps `rotated_at` on the old row, and inserts a successor carrying the **same `family_id`**. Three distinct outcomes: unknown hash → **401**; hash found with `rotated_at` already set → **replay detected**, revoke every row in that `family_id` and **401**; otherwise → new token pair. | PUBLIC (cookie) |
| POST | `/auth/logout` | Revoke the current session — expires every row in its `family_id`, not just the current token. | USER |
| POST | `/auth/logout/all` | Revoke every session for the user across all families ("log out of all devices", RDM §1.5). | USER |
| GET | `/users/me` | Current user + org + departments + effective permission codes. Primary bootstrap call for the SPA. **Implemented.** Lives under `/users` rather than `/auth` because it is a profile read, not an authentication operation; there is deliberately no separate `GET /me`. | USER |
| POST | `/auth/password/forgot` | Create a `password_reset_tokens` row (hashed token, `ip_address`, `user_agent`, 1h `expires_at`) and email the reset link. When the address holds accounts in several tenants (RDM §1.10), issue **one row per matching account** and send a single email containing one link per organization, each labelled with its tenant name. Always **202**, whether or not the address exists — no user enumeration. | PUBLIC |
| GET | `/auth/password/reset/:token` | Validate a reset token before rendering the form (`is_used = false AND expires_at > NOW()`). Returns `{ valid, email? }` — **410** on used/expired. | PUBLIC |
| POST | `/auth/password/reset` | Consume the token: set `is_used = true`, write the new `password_hash`, invalidate the user's other outstanding tokens, and **revoke every `device_sessions` row**. | PUBLIC |
| PATCH | `/auth/password` | Change password (requires current password). Revokes all *other* sessions. | SELF |

**OTP challenges** — email/phone ownership, backed by `otps` (§1.9 of the RDM):

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| POST | `/auth/email/verify/request` | Issue an `otps` row (`purpose = EMAIL_VERIFICATION`, `target = users.email`) and mail the 6-digit code. Invalidates the user's prior outstanding email codes; Redis-rate-limited per user. | USER |
| POST | `/auth/email/verify` | Submit `{ code }`. On match → `is_email_verified = true`. On mismatch → `attempts_count++`; at `max_attempts` the code is burned (`is_used = true`) and the response is **429** with `mustRequestNewCode: true`. | USER |
| POST | `/auth/phone/verify/request` | Issue an `otps` row (`purpose = PHONE_VERIFICATION`) and SMS the code. `{ phoneNumber }` in the body becomes `otps.target`, which lets this same endpoint serve **first-time verification and change-of-number** — `users.phone_number` is not touched until the code for that exact target verifies. | SELF |
| POST | `/auth/phone/verify` | Submit `{ code }`. On match, copy `otps.target` into `users.phone_number` and set `is_phone_verified = true`. Same attempt-counter semantics as above. | SELF |
| GET | `/auth/otp/status` | `?purpose=` — outstanding-challenge state for the resend UI: `{ pending, target (masked), expiresAt, attemptsRemaining }`. Never returns `code_hash`. | SELF |

**Google sign-in** — implemented, and it doubles as sign-up:

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| POST | `/auth/google` | Verify a Firebase-issued Google ID token, upsert the user with `password_hash = NULL`, resolve the tenant, issue tokens. Returns the **same three-way outcome** as `POST /auth/login` — Google proves only the first factor, so the account may still owe 2FA, and the address may still resolve to several tenants. | PUBLIC |

**OAuth 2.0 / OIDC redirect flow** (tech-stack §7) — **DEFERRED.** `POST /auth/google` covers Google end-to-end; the redirect flow earns its keep only when adding a second provider (GitHub) or enterprise SSO. Specified here so the shape is settled when that day comes:

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/auth/oauth/:provider` | Redirect to provider (`provider ∈ google \| github`). Accepts `?organizationSlug=` or `?invitationToken=`, carried through the OAuth `state` parameter so the callback knows which tenant is intended. | PUBLIC |
| GET | `/auth/oauth/:provider/callback` | Exchange code, upsert user with `password_hash = NULL`, issue tokens. The provider returns a verified address but **not** a tenant: resolve it from `state`, else from a domain match, else fall back to the same `requiresTenantSelection` response as `POST /auth/login` (RDM §1.10). | PUBLIC |
| GET | `/auth/oauth/connections` | List linked providers for the current user. | SELF |
| DELETE | `/auth/oauth/:provider` | Unlink a provider (blocked if it is the only credential). | SELF |

**Invitations** — backed by `user_invitations` (RDM Table 28), seat-quota gated:

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| POST | `/users/invitations` ✎ | Invite one or many. Body is a single object **or** an array of `{ email, roleIds[], departmentIds[], primaryDepartmentId? }`. An array is stamped with a shared `batch_id`. Partial success is the norm, so a bad address never fails the batch: **207** with `{ created: [...], failed: [{ email, reason }] }`. Seat-gated on active agents + PENDING invites. | perm:`user.invite` |
| POST | `/users/invitations/preview` | Dry-run a list before sending: flags addresses already in this tenant, malformed addresses, unknown role/department ids, and projected seat overrun. No rows written, no mail sent. For a 200-person import this is the difference between a clean rollout and 40 support tickets. | perm:`user.invite` |
| GET | `/users/invitations` | List invitations. Filters `?status=PENDING\|ACCEPTED\|REVOKED\|EXPIRED&batchId=&q=`. Returns `resentCount`, `lastSentAt`, `expiresAt`, inviter. Never returns `token_hash`. | perm:`user.read` |
| GET | `/users/invitations/:id` | Single invitation detail incl. resolved role/department names. | perm:`user.read` |
| POST | `/users/invitations/:id/resend` ✎ | Re-send. **Rotates the token** — the previous link dies immediately, same discipline as password reset. Increments `resent_count`, stamps `last_sent_at`, extends `expires_at`. Redis rate-limited per invitation id so the endpoint cannot be weaponized into an email bomb. **409** unless `status = PENDING`. | perm:`user.invite` |
| DELETE | `/users/invitations/:id` ✎ | Revoke: `status = REVOKED`, stamps `revoked_by_id`/`revoked_at`, releases the seat reservation. Row retained for audit. **409** if already `ACCEPTED`. | perm:`user.invite` |
| GET | `/users/invitations/token/:token` | Public preview. Path segment `token/` disambiguates it from `GET /users/invitations/:id` below — two bare `:param` patterns on one path cannot coexist in Nest. Returns: `{ organizationName, inviterName, roleNames[], email (masked), expiresAt }`. The inviter's name is the strongest anti-phishing signal in the email, so it is worth exposing. Rate-limited by IP; **410** on revoked/expired/accepted. | PUBLIC |
| POST | `/users/invitations/accept` | Redeem. **Token travels in the body, not the path** — a single-use secret in a URL lands in access logs, browser history and `Referer` headers; same discipline as `POST /auth/password/reset`. Creates the user with `is_email_verified = true` (delivery to the address is the same ownership proof an OTP provides), write `user_roles` + `user_departments` from the validated arrays, link `accepted_user_id`, issue tokens. Re-validates seat quota (**409**), tenant status (**403** unless `ACTIVE`/`PENDING_ONBOARDING`), and each role/department id — ids that no longer resolve are skipped and reported, never fatal. | PUBLIC |

*Audit actions:* `USER_LOGIN`, `USER_LOGIN_FAILED`, `USER_LOGOUT_ALL`, `REFRESH_TOKEN_REPLAY_DETECTED` (family revoked — high-severity, should alert), `DEVICE_TRUSTED`, `DEVICE_TRUST_REVOKED`, `PASSWORD_RESET_REQUESTED` (with `ip_address`/`user_agent` from the token row), `PASSWORD_RESET_COMPLETED`, `PASSWORD_CHANGED`, `EMAIL_VERIFIED`, `PHONE_VERIFIED`, `PHONE_NUMBER_CHANGED`, `OTP_ATTEMPTS_EXCEEDED`, `USER_INVITED`, `INVITE_ACCEPTED`, `INVITE_RESENT`, `INVITE_REVOKED`, `INVITE_EXPIRED` (written by the pruning cron with `user_id = NULL`), `OAUTH_LINKED`.

### 1.2 Two-Factor Auth — `/auth/2fa`

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| POST | `/auth/2fa/setup` | Generate + encrypt `two_factor_secret`, return `otpauth://` URI and QR data URL. Not yet enabled. | SELF |
| POST | `/auth/2fa/enable` | Confirm a TOTP code → `is_two_factor_enabled = true`; returns the one-time plaintext backup codes. | SELF |
| POST | `/auth/2fa/authenticate` | **Second leg of login.** Exchange the `two_factor` challenge cookie + TOTP (or backup code) for tokens. With `rememberDevice`, issues a device secret → `device_token_hash`, `is_trusted = true`, `trusted_until = NOW() + 30d`, as an HTTP-only `SameSite=Strict` cookie. Lives here rather than at `/auth/login/2fa` so all six 2FA operations share one controller. | PUBLIC (cookie) |
| DELETE | `/auth/2fa` | Disable 2FA (requires TOTP + password). **409** when `organizations.enforce_two_factor = true`. | SELF |
| POST | `/auth/2fa/backup-codes` | Regenerate `two_factor_backup_codes` (30d expiry). Invalidates unused codes; **dedupe-checks generated codes** per todo note. | SELF |
| GET | `/auth/2fa/backup-codes` | Metadata only — count remaining, `is_used`, `expires_at`. Never returns hashes or plaintext. | SELF |

### 1.3 Device Sessions — `/auth/sessions`

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/auth/sessions` | List own sessions. **Must filter `rotated_at IS NULL AND expires_at > NOW()`** — spent rotation rows are retained for replay detection and would otherwise surface as one bogus "device" per refresh. One entry per `family_id`. Returns `device_name`, `ip_address`, `is_trusted`, `trusted_until`, `expires_at`, `current: bool`. | SELF |
| DELETE | `/auth/sessions/:id` | Revoke one session — expires the whole `family_id`, so a rotation already in flight cannot outlive the revocation. | SELF |
| DELETE | `/auth/sessions/:id/trust` | Drop device trust for one session (clear `device_token_hash` / `trusted_until`, `is_trusted = false`) while leaving it logged in. | SELF |
| DELETE | `/auth/sessions/trusted` | Un-trust every device → forces 2FA everywhere. Sessions stay alive. | SELF |
| GET | `/users/:userId/sessions` | Admin view of another user's sessions. | perm:`user.session.read` |
| DELETE | `/users/:userId/sessions` ✎ | Admin force-logout of a user (incident response). | perm:`user.session.revoke` |

### 1.4 Organizations (own tenant) — `/organizations/current`

Tenant admins only ever address their **own** org; the tenant comes from the JWT, not the URL.

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/organizations/current` | Tenant profile + status + quotas. | USER |
| PATCH | `/organizations/current` ✎ | Update `name`, `slug`, `domain`. | perm:`organization.update` |
| GET | `/organizations/current/settings` | Security governance: `enforce_two_factor`, `allowed_email_domains`. | perm:`organization.read` |
| PATCH | `/organizations/current/settings` ✎ | Update the above. Enabling `enforce_two_factor` flags all users for enrollment. | perm:`organization.update` |
| GET | `/organizations/current/usage` | Live meters: seats used/max, storage used/max, AI tokens used/budget, `billing_cycle_start`. | perm:`organization.read` |
| GET | `/organizations/current/onboarding` | Onboarding checklist state (departments created, first doc indexed, agents invited). | USER |
| POST | `/organizations/current/onboarding/complete` ✎ | `PENDING_ONBOARDING` → `ACTIVE`. | perm:`organization.update` |
| DELETE | `/organizations/current` ✎ | Request tenant offboarding (soft delete; may require Super Admin confirmation). | perm:`organization.delete` |

### 1.5 Departments — `/departments`

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/departments` | List departments in tenant (+ member counts, open-ticket counts). | USER |
| POST | `/departments` ✎ | Create. | perm:`department.create` |
| GET | `/departments/:id` | Detail. | USER |
| PATCH | `/departments/:id` ✎ | Update `name`, `description`. | perm:`department.update` |
| DELETE | `/departments/:id` ✎ | Soft delete. **409** if it still owns open tickets — require reassignment first. | perm:`department.delete` |
| POST | `/departments/:id/restore` ✎ | Undo soft delete. | perm:`department.delete` |
| GET | `/departments/:id/members` | Members (via `user_departments`), flagging `is_primary`. | perm:`department.read` |
| POST | `/departments/:id/members` ✎ | Bulk add users (`{ userIds[], isPrimary? }`) → `user_departments`, stamps `assigned_by_id`. | perm:`department.member.assign` |
| DELETE | `/departments/:id/members/:userId` ✎ | Remove a user from the department. | perm:`department.member.assign` |
| GET | `/departments/:id/agents/availability` | Agent presence + current load, for routing/assignment UI. **NOT BUILT, and the note that said "neither exists yet" is half stale**: `PresenceService` ships, Redis-backed with a TTL. What is missing is a BATCH presence read (`read()` is per-user, so a thirty-agent department is thirty round trips — `MGET` over the same key function is one) and a grouped open-ticket count, which nothing exposes. The shape is a **gateway-side join**: presence is connection state and lives in api-gateway, so this is gRPC to auth-service for the agent list, `MGET` against the gateway's own Redis, then gRPC to ticket-service for the counts, assembled in a controller — three hops on a routing screen, with a caching decision in it. | perm:`ticket.assign` |

### 1.6 Users — `/users`

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/users` | List tenant users. Filters: `?departmentId=&roleId=&isLocked=&q=`. `isLocked` filters the **boolean**, which is authoritative — a user whose `locked_until` has passed but whom the sweep has not yet reached still reads as locked here, and that is correct rather than a lag to paper over. | perm:`user.read` |
| POST | `/users` ✎ | Admin-create a user directly. **Narrow purpose: seeding, migrations, and service accounts — not the fast path for adding a colleague.** Inviting is strictly safer for humans: an admin-chosen password must be transmitted out-of-band, and `is_email_verified` starts false and unproven. Accepts `sendInvitationEmail: true` to create the row and dispatch an invitation instead of a password, which is the recommended default for any real person. Seat-gated. | perm:`user.create` |
| GET | `/users/:id` | Detail + roles + departments. | perm:`user.read` |
| PATCH | `/users/:id` ✎ | Update `full_name`, `phone_number`, `dob`, `gender`, `avatar_url`. | perm:`user.update` |
| DELETE | `/users/:id` ✎ | Soft delete (deactivate) + revoke all sessions. Blocked on self. | perm:`user.delete` |
| POST | `/users/:id/restore` ✎ | Reactivate. | perm:`user.delete` |
| POST | `/users/:id/lock` ✎ | `{ reason, lockedUntil? }` → `is_locked = true` + revoke sessions. **`lockedUntil` is optional and must be in the future**; omitting it means an indefinite lock, which is the existing behaviour unchanged. `is_locked` stays the one boolean every read asks about — `locked_until` is an *expiry*, cleared by a lazy unlock on the login path and by an hourly sweep ([ADR 0027](./decisions/0027-lock-state-is-constrained-not-conventional.md)). The lock email states the end time in the recipient's timezone. | perm:`user.lock` |
| POST | `/users/:id/unlock` ✎ | `is_locked = false` **and `locked_until = NULL`** — clearing only the boolean would leave a stale expiry for a later re-lock to inherit. Grants no sessions back: unlocking permits signing in, it does not sign in. | perm:`user.lock` |
| POST | `/users/:id/2fa/reset` ✎ | Admin clears `two_factor_secret` + backup codes (lost-device recovery). | perm:`user.2fa.reset` |
| PUT | `/users/:id/departments` ✎ | Replace the full membership set; exactly one `is_primary` enforced (partial unique index, RDM Table 4). | perm:`department.member.assign` |
| PUT | `/users/:id/roles` ✎ | Replace the role set and recompute `roles.user_assigned` **in the same transaction** as the junction write. **Refused when it would demote the tenant's last active Org Admin** — demotion is the third way to remove an administrator, alongside delete and lock. Grant provenance goes to `audit_logs` (`USER_ROLES_UPDATED`, resource = the USER, metadata `{ before, after }` — grant and revoke are distinguishable from the diff, so there is no separate `ROLE_ASSIGNED`/`ROLE_REVOKED` pair), **not** to the join row — `_user_roles` is an implicit m2m and carries no columns beyond the two ids (RDM Tables 7–8). Rejects a role from another tenant; admits global system roles. | perm:`user.role.assign` |
| GET | `/users/:id/permissions` | Flattened effective permission codes (role union). Same computation as the JWT claim — one shared function, or the two disagree the first time either changes. | perm:`user.read` |

> **No `GET /users/:id/roles` or `/departments` sub-resources.** `GET /users/:id` already returns `roleIds`, `roleNames` and `departmentIds` on `UserSummaryResponse`, so a separate round trip would return a strict subset of what the caller just fetched. The `PUT` counterparts exist because replacing a set is a genuinely different operation from reading one.

**Own profile** (`/users/me` — no `user.*` permission needed):

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/users/me` | Own profile + org + departments + effective permission codes. **Implemented.** | SELF |
| PATCH | `/users/me` | Update own profile fields (`fullName`, `dob`, `gender`). Explicitly **not** `avatarUrl` — that goes through the two rows below, never a direct field write, because writing it here would bypass the old-file cleanup and the confirm-time existence check — nor `email`/`phoneNumber` (the OTP flow), nor `isEmailVerified`/`isLocked`/roles/departments. **Implemented**, minus the `avatarUrl` field which was never actually wired to write it. | SELF |
| POST | `/users/me/avatar/upload-url` | Presign a direct-to-Firebase-Storage upload: `{ contentType, sizeBytes }` → `{ uploadUrl, objectPath, expiresAt }`. Image mime allowlist + 2MB cap enforced before signing. See [ADR 0024](./decisions/0024-one-upload-mechanism.md). | SELF |
| POST | `/users/me/avatar/confirm` | `{ objectPath }` — confirms the upload landed, writes `users.avatar_url` (an object path, not a URL — RDM Table 3), audits, and emits the async delete of the **previous** avatar if one existed. | SELF |
| DELETE | `/users/me/avatar` | Clear `avatar_url` to `null`; emits the async delete of the object that was there. | SELF |
| ~~GET~~ | ~~`/users/me/tickets`~~ | **Not built — `GET /tickets` already is this.** Reads are not gated on `ticket.read.all`; ticket-service narrows to what the caller authored or is assigned, so an end user calling `GET /tickets` gets exactly their own. `?authorId=` — on the REST query DTO and the GraphQL args both — narrows it for an agent, who would otherwise see the queue. There is no caller this route serves and that one does not. | ~~SELF~~ |

> **Notifications moved.** The `/me/notifications*` endpoints previously listed here are **Domain E**, owned by `notification-service`, not `auth-service` — see **§4b**. They were relocated because the §8 ownership map routes by path prefix, so anything under `/users/*` resolves to `auth-service`; leaving them here silently assigned a whole domain's endpoints to the wrong service.
>
> The `/me` → `/users/me` prefix change is the same reconciliation that moved `GET /auth/me` → `GET /users/me`: one bootstrap surface, not three.

### 1.7 Roles, Permissions & RBAC — `/roles`, `/permissions`

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/roles` | Tenant custom roles **+** global system roles (`organization_id IS NULL`). | perm:`role.read` |
| POST | `/roles` ✎ | Create a custom role; `(organization_id, name)` unique. | perm:`role.create` |
| GET | `/roles/:id` | Detail + attached permissions + `user_assigned`. | perm:`role.read` |
| PATCH | `/roles/:id` ✎ | Update `name`/`description`. **403** when `is_system_role = true`. | perm:`role.update` |
| DELETE | `/roles/:id` ✎ | Delete. **403** on system roles; **409** if `user_assigned > 0`. | perm:`role.delete` |
| PUT | `/roles/:id/permissions` ✎ | Replace the permission set in one transaction. Provenance to `audit_logs` (`ROLE_PERMISSIONS_UPDATED`); `_role_permissions` holds no payload columns (RDM Tables 7–8). Subject to the same no-escalation rule as role assignment: an actor may not grant a permission they do not themselves hold. | perm:`role.permission.assign` |
| GET | `/permissions` | Full permission catalogue, grouped by `target` prefix — drives the role editor UI. | perm:`role.read` |
| ~~GET~~ | ~~`/roles/:id/users`~~ | **Not built, and will not be** — this is `GET /users?roleId=<id>`, which already has pagination, `?searchTerm=`, sorting and soft-delete handling. A second URL over the same query serves nobody: `role.read` is held by `ORG_ADMIN` alone, and `ORG_ADMIN` is `PERMISSION_CODES`, so every caller who could use this route already holds `user.read`. Revisit only if a custom role ever grants `role.read` without it. | — |
| POST | `/roles/:id/users` ✎ | Bulk-assign the role, leaving each user's other roles alone. **ADD semantics**, unlike `PUT /users/:id/roles`: a user who already holds it is a no-op, and `user_assigned` moves by the delta rather than the request size. All-or-nothing — an unknown or foreign user id fails the whole request. Applied through `setUserRoles` per user, so it inherits the tenant check, the no-escalation rule and the last-Org-Admin guard. Bounded by `MAX_ROLE_ASSIGNMENT_USERS`. | perm:`user.role.assign` |
| DELETE | `/roles/:id/users/:userId` ✎ | Revoke the role from one user. **404 when they do not hold it** — "already gone" and "I removed it" must not look alike in an audit trail. **Refused when it would demote the tenant's last active Org Admin**; this is the route that names that operation, and the guard lives on `setUserRoles` so this path cannot walk around it. | perm:`user.role.assign` |

`permissions` rows are seeded, not created at runtime — there is no `POST /permissions` for tenants (see `/platform/permissions`).

> **No `GET /roles/:id/permissions`.** `GET /roles/:id` already returns `permissionCodes` on `RoleResponse`.
>
> The three role→user routes above are the **inverse direction** of `PUT /users/:id/roles` and are genuinely absent. Nothing is blocked without them — assigning from the user side covers every case — but "add 20 people to this role" currently costs 20 calls. Build them when the admin UI needs that affordance, not before.

### 1.8 Platform Super Admin — `/platform`

RDM §1.7: `organization_id IS NULL`, `is_super_admin = true`; audit rows written with `organization_id = NULL`.

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/platform/organizations` | All tenants, filter by `status`. | SUPER |
| POST | `/platform/organizations` ✎ | Onboard a tenant + its first Org Admin. | SUPER |
| GET | `/platform/organizations/:id` | Tenant detail + usage rollups. | SUPER |
| PATCH | `/platform/organizations/:id` ✎ | Edit any tenant field, incl. quotas (`max_agent_seats`, `max_storage_bytes`, `monthly_ai_token_budget`, `ai_model_tier`). **These five are entitlements the Stripe webhook writes** (RDM §1.15) — a manual edit here is an override that the next `customer.subscription.updated` will revert. Correct for a support gesture, wrong as a way to sell an upgrade. | SUPER |
| POST | `/platform/organizations/:id/status` ✎ | Transition `status` (suspend past-due, freeze, reactivate) with a reason. | SUPER |
| POST | `/platform/organizations/:id/billing-cycle/reset` ✎ | Roll `billing_cycle_start` → resets AI metering. **Break-glass only once billing is live** — `billing_cycle_start` follows Stripe's `current_period_start` (RDM §1.15), so a manual roll desynchronizes the quota window from the invoice period *and* silently grants a fresh budget, since the cycle epoch is inside the Redis quota key. Kept because it is genuinely needed to make a tenant whole after an incident; writes an audit row with a mandatory reason. | SUPER |
| DELETE | `/platform/organizations/:id` ✎ | Soft-delete/offboard a tenant. | SUPER |
| POST | `/platform/organizations/:id/restore` ✎ | Restore an offboarded tenant. | SUPER |
| GET | `/platform/users` | Cross-tenant user search (support escalations). | SUPER |
| GET | `/platform/roles` | Manage global system roles. | SUPER |
| POST | `/platform/roles` ✎ | Create a system role (`is_system_role = true`). | SUPER |
| ~~GET~~ | ~~`/platform/permissions`~~ | **Not built, and will not be.** `GET /permissions` already serves the catalogue to every caller who could want it — `listPermissions()` takes no tenant context, and `PermissionGuard` returns early for a Super Admin, so `role.read` is not a barrier to one. The single thing a platform view could have shown is drift between `PERMISSION_CODES` and the table, and `is_retired` on the existing route shows it to the tenant admin who is actually looking at the editor. [ADR 0038](./decisions/0038-permissions-are-a-compile-time-artifact.md). | — |
| ~~POST~~ | ~~`/platform/permissions`~~ | **Not built, and never should be** — not a deferral. A permission is a union member, not a row: `@RequirePermission('x')` is a compile error unless `x` is in `PERMISSION_CODES`, so a runtime-created code could be required by no route, enforced by no guard, and granted by nothing — `assertGrantable` refuses it. It would appear in the role editor and do nothing, which is worse than absent. A new permission ships with a deploy. [ADR 0038](./decisions/0038-permissions-are-a-compile-time-artifact.md). | — |
| GET | `/platform/audit-logs` | Cross-tenant audit trail, incl. `organization_id IS NULL` rows. **Blocked on Domain D** — `audit_logs` lives in `ticket-service`, which is a scaffold. Domain A already *publishes* audit events over NATS (§8.1); this endpoint appears when the sink does. | SUPER |
| GET | `/platform/metrics` | Platform-wide health: tenant count, MRR-ish usage, AI spend. | SUPER |
| GET | `/platform/jobs` | **Scheduled-job health.** Every job this build EXPECTS, with `lastSucceededAt`, duration, consecutive failures and a verdict of `healthy` / `stale` / `failing` / `never-ran`. Judged against the expected list rather than the rows returned, because a job that has never run has no row — which is exactly how seven uncalled jobs stayed invisible for two domains. Three-leg fan-out: the heartbeat table lives in each owning service's database. | SUPER |
| POST | `/platform/jobs/:name/run` | Runs a rollup now. A POST rather than a GET because it does work, and a GET is something a browser prefetch or an automatic retry can trigger with nobody asking. | SUPER |
| POST | `/platform/jobs/:name/backfill` | Recomputes an explicit `from`..`to` range, with a **mandatory `reason`**. Safe to expose only because the jobs are idempotent and range-bounded ([ADR 0009](./decisions/0009-rollups-are-plain-tables.md)). Needed because a rollup bug fixed going forward leaves the wrong numbers in place permanently. | SUPER |

---

### 1.9 Billing & Subscription — `/billing`, `/webhooks/stripe`

**Not built.** Specced here because it changes the meaning of endpoints that *are* built (§1.8's quota edits and cycle reset) and because Domain C's AI tier depends on it. Full design in [ADR 0026](./decisions/0026-stripe-webhook-idempotency.md); RDM §1.15 and Table 30.

**The division of labour:** Stripe owns plans, prices, cards and renewals. This system owns *entitlements* — the five columns on `organizations`. The webhook is the only thing that connects them.

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/billing/subscription` | Current plan, status, period, and the entitlements it granted. Reads Postgres, **not** Stripe — a dashboard that fans out to a third party on every load fails when they do. | perm:`organization.read` |
| POST | `/billing/checkout-session` ✎ | `{ priceId }` → a Stripe Checkout URL. Entitlements are **not** written here; they are written when the webhook confirms. A user who closes the tab mid-checkout must not end up upgraded. | perm:`organization.update` |
| POST | `/billing/portal-session` ✎ | → a Stripe Customer Portal URL. Card updates, plan changes and cancellation all happen there rather than in bespoke UI, which is the main reason to use Stripe at all. | perm:`organization.update` |
| GET | `/billing/invoices` | Invoice history, proxied from Stripe and cached. The one place a live Stripe read is correct, because invoices are not mirrored. | perm:`organization.update` |
| POST | `/webhooks/stripe` | **Unauthenticated by design** — authenticated by Stripe's signature over the **raw** request body. The entitlement writer. | PUBLIC |

**Four things about the webhook route that break it silently if missed:**

- **It needs the raw body.** A global JSON body parser re-serializes the payload and the signature no longer verifies — the route must be registered with a raw-body parser *before* the global one, and this is the single most common way this integration fails on first deploy.
- **It bypasses the §0.4 lifecycle gate.** The gate reads `organizations.status`, and this endpoint's job is to *write* it. A `SUSPENDED_PAST_DUE` tenant whose payment succeeds must be able to receive the event that reactivates them, which a status gate would block.
- **It bypasses tenant scoping.** There is no JWT and no tenant context; the tenant is resolved from `stripe_customer_id`, and an unresolvable customer is stored with `organization_id = NULL` rather than dropped (RDM Table 30).
- **It is idempotent and order-guarded, not merely "handled."** `billing_events.stripe_event_id` UNIQUE for redelivery; `stripe_created_at` monotonic check for reordering. Both are load-bearing — see RDM §1.15 for what the second one prevents.

*Audit actions:* `BILLING_SUBSCRIPTION_CHANGED`, `BILLING_ENTITLEMENTS_APPLIED`, `BILLING_WEBHOOK_FAILED`.

---

## 2. Domain B — Support Engine (`ticket-service`)

### 2.1 Tickets — `/tickets`

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/tickets` | Queue view. Filters: `?status=&priority=&departmentId=&assigneeId=&authorId=&createdFrom=&createdTo=&q=`. Non-agents see only their own. | USER |
| POST | `/tickets` ✎ | Create a ticket directly (form submission path). Sets `source = WEB`. Emits `ticket.created`. | USER |
| GET | `/tickets/:id` | Full detail: ticket + author + current_assignee + current_department + status + `ai_summaries` + attachment counts. | USER / perm:`ticket.read.all` |
| PATCH | `/tickets/:id` | Update `title`, `description`, `priority`. **Never `status`** — that moves through the state machine and nowhere else. Priority is here rather than on a route of its own precisely because it has no machine: any value to any value, so there is no transition to validate and no 409 to raise. | perm:`ticket.update` |
| DELETE | `/tickets/:id` ✎ | Soft delete. | perm:`ticket.delete` |
| POST | `/tickets/:id/restore` ✎ | Undo soft delete. | perm:`ticket.delete` |
| GET | `/tickets/by-number/:ticketNumber` | Lookup by human-friendly `ticket_number` (e.g. `#1042`). | USER |
| POST | `/tickets/:id/status` | State-machine transition over `NEW → OPEN → PENDING_AGENT → ESCALATED`. Illegal transitions ⇒ **409**. **`RESOLVED` and `CLOSED` are refused here (400, naming the route to use)**: they carry `ticket.resolve` on `/resolve` and `/close`, and this route carries `ticket.update` — accepting them would be a way around the stronger right for anyone holding the weaker one. | perm:`ticket.update` |
| ~~POST~~ | ~~`/tickets/:id/priority`~~ | **Not built — `PATCH /tickets/:id` already carries `priority`**, same permission and same effect. Status is its own route because it is a state machine with illegal transitions and a 409; priority has no such machine, which is exactly why it belongs in the general update. Bulk priority is `POST /tickets/bulk/priority`. | ~~perm:`ticket.update`~~ |
| POST | `/tickets/:id/assign` ✎ | Set `assignee_id` (+ optional `department_id`). Emits `ticket.assigned` → notification. | perm:`ticket.assign` |
| POST | `/tickets/:id/assign/self` ✎ | Agent claims the ticket from a queue. | perm:`ticket.assign.self` |
| DELETE | `/tickets/:id/assign` ✎ | Unassign back to the department queue. | perm:`ticket.assign` |
| POST | `/tickets/:id/escalate` ✎ | Tier 1 → Tier 2. Sets `status = ESCALATED` + `escalated_at`, routes to a department, and triggers AI summary generation (RDM §1.3). One-click escalation from chat. Optional body `{ reason? }`, recorded on the status history — the `/chat` alias sends none, and stays a literal alias. | USER |
| POST | `/tickets/:id/resolve` | Mark resolved. Stamps `resolved_at`. **The only route to `RESOLVED`** — `POST /:id/status` refuses it, because this permission is stronger than that route's. Optional body `{ reason? }`, recorded on the status history. | perm:`ticket.resolve` |
| POST | `/tickets/:id/reopen` | `RESOLVED`/`CLOSED` → `OPEN`, clears `resolved_at` and KEEPS `escalated_at`. Optional body `{ reason? }`, recorded on the status history. | USER |
| POST | `/tickets/:id/close` | Final close. **The only route to `CLOSED`**, same reason as `/resolve`. Optional body `{ reason? }`. Permission corrected from `ticket.update` to match the code, which has required `ticket.resolve` since the route was built — closing and resolving are one right. | perm:`ticket.resolve` |
| GET | `/tickets/:id/history` | **STATUS history**, oldest first, from `ticket_status_changes` — written inside the status transaction, so it has no holes. Not from `audit_logs`, which is read behind an admin permission ([ADR 0040](./decisions/0040-ticket-status-history-is-a-table-not-a-trail.md)). ADR 0040's other argument — that the trail was at-most-once — was overtaken by [ADR 0041](./decisions/0041-durable-subjects-are-the-ones-with-nothing-to-reconcile-against.md), which made `audit.record` durable; the permission boundary settled it independently and still does. Reassignments are at `GET /tickets/:id/assignments`; merging the two would be one list with two shapes. Unpaginated. | USER |
| GET | `/tickets/:id/similar` | Past resolved tickets with similar content — agent co-pilot (product §6.3). Backed by `rag-service` over ticket embeddings. | perm:`ticket.read.all` |
| POST | `/tickets/bulk/status` | Bulk status change over `{ ticketIds[], status, reason? }`. Per-item result; `RESOLVED` and `CLOSED` are refused for the whole request — see `POST /tickets/:id/status`. Capped at `MAX_BULK_TICKET_IDS`. | perm:`ticket.update` |
| POST | `/tickets/bulk/priority` | Bulk priority change over `{ ticketIds[], priority }`. Per-item result, same cap. No `reason`: priority has no state machine, so there is nothing to justify against. | perm:`ticket.update` |
| ~~POST~~ | ~~`/tickets/bulk/assignee`~~ | **Not built, and not a fourth row of this shape.** Which permission applies is decided per ticket — assigning a held ticket is a *reassignment* (`ticket.reassign`), an unheld one is `ticket.assign`, and a self-claim is `ticket.assign.self` — so no static guard is correct for a mixed list. And `AssignTicketRequest.department_id` is required while `{ ticketIds[] }` carries one department for the batch: sending the caller's own would move tickets between departments as a side effect of assigning them. Use `POST /tickets/:id/assign` per ticket. | — |
| POST | `/tickets/export` | **CSV only**, async: `202` with an export id, then `GET /tickets/export/:id` for the signed URL. `xlsx` is not a permitted `StoragePurpose.EXPORT` type and adding it means a library, a content-signature entry and a streaming story worse than CSV's — a spreadsheet opens a CSV. **POST, not GET**: a GET that writes is one a browser prefetch, a link preview or an automatic retry can trigger, each producing another file. Bounded by `MAX_EXPORT_SPAN_DAYS` and `MAX_EXPORT_ROWS`. | perm:`ticket.export` |

### 2.2 Ticket Messages — `/tickets/:id/messages`

The unified Tier 1 + Tier 2 timeline (RDM §1.3).

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/tickets/:ticketId/messages` | Chronological thread, cursor-paginated (`?before=&limit=`). `is_internal_note = true` rows are **stripped** for non-agents. | USER |
| POST | `/tickets/:ticketId/messages` ✎ | Post a message. `{ content, isInternalNote?, invokeAi?, generatedFromId? }`. **`generatedFromId`** references the `ai_generations` row a co-pilot draft came from; the service diffs `content` against the stored draft and sets that row's `outcome` to `ACCEPTED` (verbatim) / `EDITED` (changed). Without it, draft acceptance rate is uncomputable — see §4. With `invokeAi` the gateway streams the LLM answer over WebSocket and persists it as a second message with `is_ai_generated = true`, `model_name`, `prompt_tokens`, `completion_tokens`. | USER |
| ~~GET~~ | ~~`/tickets/:ticketId/messages/:messageId`~~ | **Not built, deliberately.** `GET .../messages` already returns attachments and citations, so this is a strict subset of what the caller has. The deep-link case is a client concern: it must fetch the page containing the message to render the surrounding thread anyway, and a single message with no context is not a screen. Revisit if a notification ever deep-links into a thread too large to page to. | ~~USER~~ |
| PATCH | `/tickets/:ticketId/messages/:messageId` | Edit own message inside a short window; internal notes editable by agents. | SELF / perm:`ticket.message.moderate` |
| DELETE | `/tickets/:ticketId/messages/:messageId` | Redact a message (content replaced, row retained for the audit timeline). | perm:`ticket.message.moderate` |
| POST | `/tickets/:ticketId/messages/:messageId/attachments/upload-url` | Presign a direct-to-Firebase-Storage upload: `{ contentType, sizeBytes }` → `{ uploadUrl, objectPath, expiresAt }`. Enforces the per-message attachment count cap (todo note: "set maximum file (image) attachments") **before** signing — a caller already at the cap never receives a usable URL. See [ADR 0024](./decisions/0024-one-upload-mechanism.md). | USER |
| POST | `/tickets/:ticketId/messages/:messageId/attachments/confirm` | `{ objectPath }` — confirms, writes the `message_attachments` row. | USER |
| GET | `/tickets/:ticketId/messages/:messageId/attachments` | List attachments. | USER |
| GET | `/attachments/:id/download` | Short-lived pre-signed Firebase Storage URL (302 or `{ url, expiresAt }`). Tenant + ticket ACL re-checked **before** the signing call, not delegated to it. | USER |
| DELETE | `/attachments/:id` | Remove an attachment (hard delete — no independent soft-delete story for attachments) and emit the async delete of its object. | SELF / perm:`ticket.message.moderate` |
| POST | `/tickets/:ticketId/read` | Mark the thread read up to a message. Body `{ readAt? }` — the `createdAt` of the newest message the client RENDERED, clamped server-side to `now()`. Omitting it lets the server stamp its own clock, which marks read anything that arrived between the render and the request. Writes `ticket_read_states`, a per-user watermark. The badge itself is `unreadCount` on `GET /tickets`, so a queue screen costs no extra request. | USER |

### 2.3 AI Co-Pilot — `/tickets/:id/ai`

Gateway → `ticket-service` → `rag-service` over gRPC. All cost-metered against `ai_generations` (RDM Table 29).

**Generated text is GitHub-flavoured Markdown, by contract** ([ai-output-contract.md](./reference/ai-output-contract.md)) — not by habit. Models emit markdown anyway, which is a property of the model rather than of the system: a version change, a tier change or a prompt edit can silently return plain text into a renderer expecting structure, and nothing fails. The prompt now states the format, and tests assert it. **Clients must render markdown with raw HTML disabled** — the text is generated from tenant-uploaded documents, so a document containing markup can reach the renderer through an answer.

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/tickets/:id/ai/summary` | Current `ai_summaries` row: `summary_text`, `suggested_action`, `confidence_score`, `model_name`. | perm:`ticket.read.all` |
| POST | `/tickets/:id/ai/summary` ✎ | (Re)generate the summary — upserts the 1:1 `ai_summaries` row. Auto-invoked on escalate. | perm:`ticket.ai.use` |
| POST | `/tickets/:id/ai/draft` | Generate a reply draft from thread + retrieved knowledge. Returns `{ generationId, draft, citations }`; **does not** persist a message — the agent edits and sends, which is the product's whole human-approves promise. The draft *is* written to `ai_generations` (RDM Table 29) with its `content`, and `generationId` is what the client passes back as `generatedFromId` when it posts. | perm:`ticket.ai.use` |
| POST | `/tickets/:id/ai/suggestions` | Recommended KB articles + past resolutions for the sidebar (product §6.3). | perm:`ticket.ai.use` |
| POST | `/tickets/:id/ai/classify` | Suggest `priority` and `department_id` for auto-routing (product §6.2). Department IS the category/taxonomy. | perm:`ticket.ai.use` |

### 2.3b Ticket Assignment & Reassignment — `/tickets/:id/assign*`

Manage ticket ownership and department routing with full audit trail.

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| POST | `/tickets/:id/assign` ✎ | Assign ticket to an agent. `{ assigneeId, departmentId?, reason? }`. Creates a `ticket_assignments` row. Emits `ticket.assigned` → notifications. | perm:`ticket.assign` |
| POST | `/tickets/:id/assign/self` ✎ | Agent claims the ticket from their queue (convenience method). | perm:`ticket.assign.self` |
| DELETE | `/tickets/:id/assign` ✎ | Unassign ticket (back to department queue). Sets `current_assignee_id = NULL` and `unassigned_at = NOW()`. | perm:`ticket.assign` |
| POST | `/tickets/:id/reassign` ✎ | Reassign to a different agent/department. `{ assigneeId, departmentId, reason: ESCALATION \| SKILL_MISMATCH \| WORKLOAD_BALANCE \| REASSIGNMENT }`. Closes prior assignment, creates new one. Emits `ticket.reassigned` → audit + notification. | perm:`ticket.reassign` |
| GET | `/tickets/:id/assignments` | Assignment history: full lifecycle of who held ticket, when, which department, why. Returns array of `{ assigneeId, departmentId, assignedAt, unassignedAt, reason, isCurrent }`. | perm:`ticket.read.all` |

*Audit actions:* `TICKET_ASSIGNED`, `TICKET_REASSIGNED`, `TICKET_UNASSIGNED`.

### 2.4 Self-Service Chat (Tier 1) — `/chat`

Thin end-user surface over the same `tickets` + `ticket_messages` tables — a lightweight ticket is created or reused (RDM §1.3).

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| POST | `/chat/conversations` | Start a Tier 1 conversation → creates a `NEW` ticket. | USER |
| GET | `/chat/conversations` | List own conversations. | USER |
| GET | `/chat/conversations/:id` | Thread + citations per AI message. | USER |
| POST | `/chat/conversations/:id/messages` | Ask a question. Streams the RAG answer over WebSocket; falls back to a buffered JSON response when the client sets `Accept: application/json`. The answer is **Markdown by contract** (§2.3). | USER |
| POST | `/chat/conversations/:id/escalate` | One-click hand-off to a human — alias of `POST /tickets/:id/escalate`. | USER |
| ~~GET~~ | ~~`/chat/suggestions`~~ | **Not built — one row conflating two features.** Split below. Naming them together implied the harder one was a `GET` away. | ~~USER~~ |
| GET | `/chat/suggestions` (suggested) | A CURATED starter list for the empty state — a `String[]` on organization settings, edited where the rest of the tenant's AI settings are. Cheap, and waiting on a screen that renders it. | USER |
| GET | `/chat/suggestions` (popular) | **A project, not a route.** A conversation IS a ticket, so the questions are `ticket_messages` rows, and "popular" over free text is not an aggregate: two people asking the same thing write two strings and `GROUP BY content` returns one row each. It needs normalization and clustering with its own storage. The precedent is `/analytics/knowledge-gaps`, which counts EMPTY RETRIEVALS rather than question text for exactly this reason. Deriving them from document titles is rejected separately: a title is not a question, and an empty state offering *"Q4 Expense Policy v3 (final).pdf"* teaches users that the assistant wants filenames. | USER |

### 2.5 AI Feedback — `/feedback`

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| POST | `/messages/:messageId/feedback` | Thumbs up/down on an AI answer → `ai_response_feedbacks` (`rating ∈ {1,-1}`, `feedback_text?`, `citation_accurate?`). One row per (message, user) — upsert. | USER |
| GET | `/messages/:messageId/feedback` | Own feedback on that message, or `null` — 200 either way, because a client asks this per rendered AI message and "not rated" is the ordinary answer. **Not redundant with `GET /feedback`**, which filters only on `rating`/`citationAccurate`/date and is gated on `analytics.read`: the caller who wants this cannot reach it there. | USER |
| DELETE | `/messages/:messageId/feedback` | Withdraw feedback. | SELF |
| GET | `/feedback` | Tenant feedback stream for quality review; filters `?rating=&citationAccurate=&from=&to=`. | perm:`analytics.read` |

### 2.6 Audit Logs — `/audit-logs`

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/audit-logs` | Tenant-scoped immutable trail. Filters `?action=&userId=&from=&to=`. | perm:`audit.read` |
| ~~GET~~ | ~~`/audit-logs/:id`~~ | **Not built.** The justification was "single entry **incl. the JSONB `metadata` snapshot**", which implies the list omits it — it does not: ticket-service sends `metadata: JSON.stringify(log.metadata ?? {})` on every row and the gateway parses it whole through `parseAuditMetadata`, with no truncation anywhere. So this would return one row of exactly what `GET /audit-logs` already returns, behind the same permission. The clause is kept rather than deleted because it is what made the route look necessary. | ~~perm:`audit.read`~~ |
| GET | `/audit-logs/actions` | Distinct `action` values, for filter dropdowns. | perm:`audit.read` |
| POST | `/audit-logs/export` | Compliance export, **CSV or `application/json`** — JSONL is not a permitted type, and a single JSON array costs one line's difference now that the whole file is built in memory. JSON is offered here and not for tickets because `audit_logs.metadata` is genuinely nested and CSV flattens it badly. **POST, not GET**, and `202` + poll, as above. | perm:`audit.export` |

No `POST`/`PATCH`/`DELETE` — `audit_logs` is append-only and written internally via NATS.

---

## 3. Domain C — Knowledge & RAG (`ingestion-service` + `rag-service`)

### 3.1 Documents — `/documents`

> **Storage backend settled: Firebase Storage via `storage-service`.** These rows previously described a generic "S3" backend and offered multipart upload as the primary path with presign as an "alternative" — both now reversed. `ingestion-service` still does not exist, so nothing here is built; the wording is updated ahead of it so Domain C is implemented against the mechanism the other two consumers already use, rather than re-deciding it a third time. `purpose: DOCUMENT` is already reserved in `PURPOSE_POLICY` (25 MB cap, `application/pdf`/`text/plain`/`text/markdown`) — widen the allowlist there when the real parser lands, not here.

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/documents` | List documents visible to the caller (org-wide **∪** their departments' via `department_documents`). Filters `?status=&departmentId=&fileType=&q=`. | USER |
| POST | `/documents/presign` | `{ contentType, sizeBytes, fileName }` → `storage-service.PresignUpload(purpose: DOCUMENT)` → `{ uploadUrl, objectPath, expiresAt }`. **Storage-quota gated here**, before signing — `organizations.max_storage_bytes` vs `SUM(documents.file_size_bytes)`, so a tenant over quota never receives a usable upload URL. | perm:`document.create` |
| POST | `/documents/confirm` ✎ | `{ objectPath, title, isOrganizationWide, departmentIds[] }` → `ConfirmUpload` (verifies the object landed and its bytes match the declared type) → creates the `documents` row with `status = PENDING` and `file_url = objectPath` → enqueues the BullMQ ingestion job. **The row is created here, not at presign** — a presigned upload the client abandons must not leave a `documents` row pointing at an object that never arrived. | perm:`document.create` |
| GET | `/documents/:id` | Metadata + ingestion status + linked departments + chunk count. | USER |
| PATCH | `/documents/:id` ✎ | Update `title`, `is_organization_wide`. | perm:`document.update` |
| DELETE | `/documents/:id` ✎ | Soft delete — drops it from RAG context while preserving historical citations (RDM §1.6). | perm:`document.delete` |
| POST | `/documents/:id/restore` ✎ | Restore + re-add to the retrievable set. | perm:`document.delete` |
| GET | `/documents/:id/download` | Short-lived signed URL via `GetSignedReadUrls`. Visibility (org-wide ∪ caller's departments) re-checked **before** the storage call, never delegated to it — same discipline as `GET /attachments/:id/download`. | USER |
| POST | `/documents/:id/replace` | Same presign/confirm pair against the existing document id → re-chunk, re-embed, swap vectors, then emit `storage.object.superseded` (`REPLACED`) for the **old** `file_url`. Read the old path before overwriting it — the ordering trap that applies to avatars applies identically. Not atomic and deliberately so: the document is `PENDING` and unsearchable from the purge to the last upsert, which is the same window `retry` has. Open flags resolve as `DOCUMENT_REPLACED`. 202. | perm:`document.update` |
| POST | `/documents/:id/reindex` | Re-run ingestion without a new file (model or chunking-strategy change). `INDEXED` only — a document whose ingestion FAILED goes through `POST /ingestion-jobs/:id/retry`, so the two preconditions are complements. Creates a new job row and returns it; 202. Open flags are LEFT OPEN, because the file has not changed. | perm:`document.reindex` |
| GET | `/documents/:id/departments` | Departments scoped to this document. | perm:`document.read` |
| PUT | `/documents/:id/departments` ✎ | Replace `department_documents` links. Ignored while `is_organization_wide = true` (**409** to make the conflict explicit). | perm:`document.share` |
| GET | `/documents/:id/chunks` | Paginated `document_chunks`: `chunk_index`, `content_text`, `page_number`, `token_count`. Powers citation preview. | perm:`document.read` |
| GET | `/documents/:id/chunks/:chunkId` | Single chunk (citation deep-link target). | USER |
| GET | `/documents/storage` | Storage usage breakdown vs `max_storage_bytes`. | perm:`document.read` |

### 3.1b Document Quality Flags — `/documents/flags`

Knowledge Manager dashboard for content quality signals and conflict detection (product §6.4).

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/documents/flags` | List quality flags. Filters: `?type=&severity=&includeResolved=false&documentId=`. Type values: `OUTDATED\|UNRETRIEVED\|UNCITED\|LOW_CONFIDENCE\|NEGATIVE_FEEDBACK\|CONFLICTING\|PAGES_NOT_INDEXED`. Only `UNRETRIEVED` and `UNCITED` have a detector today. | perm:`document.read` |
| GET | `/documents/flags/:id` | Flag detail + related document/chunk + detection context. | perm:`document.read` |
| POST | `/documents/flags/:id/dismiss` ✎ | Resolve as `DISMISSED`: marks the flag resolved and prevents re-flagging with the same type for `DISMISSAL_SUPPRESSION_DAYS` (30). Requires a comment (reason). | perm:`document.update` |
| POST | `/documents/flags/:id/fixed` ✎ | Resolve as `FIXED`: document has been corrected. Suppresses **nothing** — a detector that finds it again is reporting that the fix did not work. | perm:`document.update` |
| POST | `/documents/flags/:id/replaced` ✎ | Resolve as `DOCUMENT_REPLACED`: old document removed, new version uploaded. | perm:`document.update` |
| DELETE | `/documents/flags/:id` | **Only for a row that should not exist** — a bad detector run, a test artefact. Hard-deletes the record. For a swept type (`UNRETRIEVED`, `UNCITED`) the next detection cycle raises it again; **dismiss** is what suppresses a finding. | perm:`document.delete` |

*Audit actions:* `DOCUMENT_FLAG_RESOLVED`, `DOCUMENT_FLAG_DISMISSED`, `DOCUMENT_FLAG_DELETED` — the acts a person takes. `DOCUMENT_FLAG_CREATED` is deliberately not emitted: raising is a sweep writing many rows per run, and `document_flags.detected_at` already records when it found something.

### 3.2 Ingestion Jobs — `/ingestion-jobs`

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/ingestion-jobs` | Pipeline dashboard. Filter `?status=&documentId=` over `QUEUED\|PARSING\|CHUNKING\|EMBEDDING\|COMPLETED\|FAILED\|CANCELLED`. | perm:`document.read` |
| GET | `/ingestion-jobs/:id` | Job detail + `error_log` + `bullmq_job_id`. | perm:`document.read` |
| POST | `/ingestion-jobs/:id/retry` ✎ | Queue a fresh attempt as a NEW job. Accepts `FAILED`, `CANCELLED`, and a `QUEUED` job the queue no longer holds. | perm:`document.reindex` |
| DELETE | `/ingestion-jobs/:id` | Cancel a queued/running job. | perm:`document.reindex` |
| GET | `/documents/:id/ingestion-jobs` | Job history for one document. | perm:`document.read` |

### 3.3 Knowledge Search — `/knowledge`

Direct RAG surface, independent of a ticket thread.

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| POST | `/knowledge/search` | Hybrid semantic + keyword retrieval, filtered by tenant **and** the caller's departments (RDM §1.2). Returns ranked chunks with document/page metadata. **The test seam for Domain C** — retrieval with no LLM in the loop, which is the only place isolation can be proven deterministically. At the AI cap it degrades to lexical-only with `degraded: "LEXICAL_ONLY"` rather than 402. | USER |
| POST | `/knowledge/ask` | One-shot Q&A: retrieve → rerank → generate, with citations. Markdown by contract (§2.3). Metered as `purpose = CHAT_ANSWER` with `ticket_id = NULL`. No ticket created, and **no escalation path** — unlike Tier 1 chat there is no conversation to escalate, so `DOC_MISSING` returns an explicit empty answer plus the gap log rather than an invented one. 402 at cap. | USER |
| GET | `/knowledge/articles` | The end-user help centre. **An "article" is not a separate entity** — it is a document that is visible to the caller (org-wide ∪ their departments), `INDEXED`, and not soft-deleted. All three: `documentVisibility` is only the department clause, and a soft-deleted document keeps `status = INDEXED`. Filters `?searchTerm=` over titles; sorts by `updatedAt` or `title`. Returns four fields — id, title, `updatedAt`, `chunkCount` — through a NARROW RPC, never a filtered `ListDocuments`. | USER |
| GET | `/knowledge/articles/:id` | One article plus a page of its extracted text, in `chunkIndex` order. Paginated by BLOCK range, since a 200-page handbook is hundreds of chunks; `meta` describes the blocks, not a page of articles. The original file stays available via `GET /documents/:id/download` for anyone entitled to it. | USER |

---

## 4. Analytics & Dashboards (cross-domain read layer)

> **Not a domain.** Analytics owns no tables — it reads across Domains B, C and D. **RDM Domain D is *Audit & Feedback*** (`ai_response_feedbacks`, `audit_logs`), whose endpoints are §2.5 and §2.6, owned by `ticket-service`. This section previously carried the "Domain D" label, which made "Domain D" mean one thing here and another in [rdm-specs.md](./rdm-specs.md).

Executive dashboard (product §6.6). Read-only, Redis-cached, `perm:analytics.read` throughout. These read daily rollup tables rather than the raw OLTP tables, and there is deliberately no `analytics-service` — [ADR 0009](./decisions/0009-rollups-are-plain-tables.md).

| Method | Path | Description |
| :---- | :---- | :---- |
| GET | `/analytics/overview` | Headline KPIs for `?from=&to=&departmentId=`: total inquiries, deflection rate, open/resolved counts, CSAT. |
| GET | `/analytics/deflection` | Self-service vs human-agent resolution split over time. |
| GET | `/analytics/response-times` | Avg time-to-first-response and avg time-to-resolution, bucketed. |
| GET | `/analytics/volume` | Ticket volume time series by status / priority / department / channel. |
| GET | `/analytics/agents` | Per-agent productivity: assigned, resolved, avg resolution time, AI-draft acceptance rate. **Acceptance rate reads `ai_generations.outcome`** (`ACCEPTED`/`EDITED`/`DISCARDED`, RDM Table 29) — it was uncomputable before that table existed, since nothing recorded that a draft had been generated at all. |
| GET | `/analytics/knowledge-gaps` | Frequent questions with low retrieval confidence or negative feedback — the content-improvement backlog. |
| GET | `/analytics/ai-usage` | Spend over time from `ai_generations`, broken down **by `purpose`** (chat answer vs draft vs summary vs embedding vs greeting classification) and by `model_name` and `ai_model_tier`, against `monthly_ai_token_budget`. The per-purpose split is what tells a tenant *where* their AI budget actually goes — often not where they assume. |
| GET | `/analytics/documents` | Most-cited documents, **never-retrieved** vs **retrieved-but-never-cited** (RDM Table 27 — two different findings that were previously one flag), citation accuracy from `ai_response_feedbacks.citation_accurate`. Reads `document_chunks` usage counters, not the ledger, which is retention-rolled. |
| GET | `/analytics/satisfaction` | Thumbs up/down trend from `ai_response_feedbacks`. |
| POST | `/analytics/export` | Async report export → `202` with an export id, then `GET /analytics/export/:id` for the signed URL. **Shipped.** |

---

## 4b. Domain E — Notifications (`notification-service`)

Backed by RDM Tables 23–25: `notifications` (per-recipient feed + read/archive state), `notification_deliveries` (per-channel send tracking), `notification_preferences` (per type/channel opt-in + digest).

Numbered `4b` rather than `5` — the same convention §2.3b and §3.1b already use for sections added after their neighbours were numbered. Inserting a true §5 would renumber seven downstream sections and every cross-reference to them across five documents, for no gain in clarity.

**Every route below is SELF-scoped** — the feed is filtered by `recipient_id = ctx.sub`, never by a client-supplied user id. There is no admin "read someone else's notifications" endpoint, and there should not be one: the feed is a personal inbox, and its contents are already recoverable from `audit_logs` for anyone who legitimately needs them.

**Prefix is `/notifications`, not `/users/me/notifications`** — the §8 ownership map routes by path prefix, and `/users/*` belongs to `auth-service`. A top-level prefix is what makes the owning service unambiguous from the route alone.

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/notifications` | Cursor-paginated feed (`?type=&unreadOnly=false&cursor=`), 20/page, newest first. Excludes `archived_at IS NOT NULL` by default. Cursor-, not offset-paginated: the feed grows at the head while being read, and offsets shift rows under the reader. | SELF |
| GET | `/notifications/unread-count` | Integer count of unread + non-archived. Served from the partial index `(recipient_id) WHERE read_at IS NULL AND archived_at IS NULL`, so badge polling stays cheap. | SELF |
| POST | `/notifications/:id/read` ✎ | Mark one read (`read_at = NOW()`). Idempotent — re-reading an already-read row is a 200, not a 409. | SELF |
| POST | `/notifications/:id/archive` ✎ | Dismiss (`archived_at = NOW()`). Hidden from the default feed, **not** deleted — `expires_at` + the pruning job own deletion. | SELF |
| POST | `/notifications/read` ✎ | Bulk read: `{ ids: [] }` **or** `{ resourceType, resourceId }`. The second form is what makes opening ticket #1042 clear all 12 of its notifications in one call, using the `resource_id` index. | SELF |
| GET | `/notifications/preferences` | Full resolved catalogue per (type, channel) — exact match, else `('*', channel)`, else the hard-coded default. Returns the **resolved** value plus whether it came from an explicit row, so the UI can show "inherited" vs "set". | SELF |
| PATCH | `/notifications/preferences` ✎ | Upsert `{ type, channel, isEnabled, digest }`. Unique on `(user_id, type, channel)`, so this is an upsert, never a duplicate-row insert. | SELF |

**Not exposed over HTTP, deliberately:**

- **`notification_deliveries` has no endpoint.** Delivery state is operational telemetry, not user-facing — a user seeing `BOUNCED` on their own email cannot act on it, and exposing `provider_message_id` leaks the ESP relationship. Surface failures through `/platform/metrics` and alerting instead.
- **No `POST /notifications`.** Notifications are *created by NATS consumers*, never by a client. An HTTP create endpoint would be an unauthenticated-by-design spam vector into other users' inboxes, and would bypass the `event_id` idempotency that makes NATS at-least-once delivery safe.

*Audit actions:* none. Reading your own inbox is not an auditable security event, and writing an `audit_logs` row per notification read would produce more audit volume than every other action in the system combined.

---

## 5. WebSocket Namespace (Socket.IO)

Namespace `/ws`, JWT-authenticated on handshake, rate-limited via `ThrottlerStorageRedisService`, fanned out across instances by `@socket.io/redis-adapter`. Rooms: `org:{organizationId}`, `ticket:{ticketId}`, `user:{userId}`, `dept:{departmentId}`, and `ticket:{ticketId}:internal` for agent-only fan-out.

**[ADR 0011](./decisions/0011-websocket-is-a-transport.md).** The transport, `ticket:join`/`leave` and every notification event are built; `message:send`, typing, presence and the AI stream relay are not. There was a **live disclosure in the shipped `message:new` fan-out** — the ticket room contains the requester, so internal notes reach them — which is why the `:internal` room above exists.

| Direction | Event | Payload / purpose |
| :---- | :---- | :---- |
| C→S | `ticket:join` / `ticket:leave` | Subscribe to a thread (membership re-authorized server-side). |
| C→S | `message:send` | Low-latency send; mirrors `POST /tickets/:id/messages`. |
| C→S | `typing:start` / `typing:stop` | Typing indicators (product §6.5). |
| C→S | `presence:update` | Agent availability (`online \| away \| busy`). |
| C→S | `ai:stream:cancel` | Abort an in-flight generation. |
| S→C | `message:new` | New message in a joined thread. |
| S→C | `message:updated` / `message:deleted` | Edit / redaction. |
| S→C | `ai:stream:chunk` | Token-by-token LLM output. **Markdown arrives incomplete by construction** — mid-stream the client holds an unclosed code fence or half a list ([ai-output-contract.md](./reference/ai-output-contract.md)). The renderer must tolerate unterminated constructs, or the answer flickers between raw and formatted on every chunk. |
| S→C | `ai:stream:done` | Final message id, citations, token counts. |
| S→C | `ai:stream:error` | Generation failure or quota exhaustion. |
| S→C | `ticket:updated` | Status / priority / assignee change. |
| S→C | `ticket:assigned` | Agent's queue got a new ticket. |
| S→C | `typing` | Peer typing state. |
| S→C | `presence` | Peer presence change. |
| S→C | `notification:new` | In-app notification — the pop-up/toast payload. Carries the full `notifications` row (`title`, `body`, `data`, `action_url`, `priority`, `group_key`, `group_count`) so the client renders and deep-links without a follow-up fetch. |
| S→C | `notification:updated` | An existing notification was **coalesced** — same `group_key`, `group_count` incremented. The client updates the existing toast in place ("12 new messages on #1042") instead of stacking a 12th. Without this event, grouping exists in the database and is invisible in the UI. |
| S→C | `notification:read` | Read/archive state changed **for this user on another device**. Fanned to `user:{userId}`, which every one of that user's sockets joins — so dismissing on mobile clears the desktop badge. `read_at` is per-row, not per-connection; without this event, two open tabs disagree until refresh. |
| S→C | `notification:unread-count` | Authoritative unread total, pushed on every change. Lets the client stop polling `GET /notifications/unread-count` entirely and avoids the drift that comes from incrementing a local counter. |
| S→C | `document:indexed` | Ingestion finished — refresh the KB list. Fanned to the uploader plus each `dept:{departmentId}` the document is scoped to, or `org:` only when it is organization-wide: a department-scoped document is invisible outside its departments, so a tenant-wide announcement would disclose its existence and title to exactly the people that boundary excludes. |
| S→C | `document:failed` | Indexing failed, carrying the pre-redacted `reason`. **To the uploader alone** — a failure is not department news, and without it a Knowledge Manager watches a document sit in `PROCESSING` forever. |

---

## 6. Ops & Infrastructure Endpoints

**[ADR 0010](./decisions/0010-readiness-probes-do-not-cascade.md)** — `/health` exists, `/version` and `/metrics` do not, and no backing service has a probe of any kind. There was a live availability bug: gateway readiness gated on gRPC peer health, so one service being down removes every gateway instance from rotation.

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/health` | Liveness. | PUBLIC |
| GET | `/health/ready` | Readiness — Postgres, Redis, NATS, gRPC peers, Qdrant. | PUBLIC |
| GET | `/version` | Build SHA + semver. | PUBLIC |
| GET | `/metrics` | Prometheus scrape (bound to the internal interface, not via Nginx). | internal |
| GET | `/docs` · `/docs-json` | Swagger UI / OpenAPI spec. **[ADR 0028](./decisions/0028-swagger-envelope-is-a-per-route-decorator.md)** — the CLI plugin (which turns 50 files of hand annotation into one config block), the two envelope decorators, and the four cookie auth schemes this API actually uses. Gate exposure on validated config, never on an inline `NODE_ENV` check. | PUBLIC in non-prod |
| GET | `/graphql` | Apollo endpoint + Playground (non-prod). **[ADR 0014](./decisions/0014-narrow-graphql-edge-types.md) and [ADR 0013](./decisions/0013-batch-rpcs-map-from-keys.md).** REST and GraphQL are permanent peers, not a migration — GraphQL is the SPA's read surface, REST keeps commands, files and machine callers. | USER |
| POST | `/webhooks/email/inbound` | Email-to-ticket ingestion. HMAC-signature verified. **[ADR 0018](./decisions/0018-inbound-email-routing-and-threading.md).** The address is `support+{inbound_token}@…`, so the tenant comes from the recipient rather than from the sender's domain; unknown senders are auto-provisioned only when their domain is already in `allowed_email_domains`, reusing the self-signup rule. Attachments and non-user senders are out of v1 scope, declared rather than discovered. | signature |
| ~~POST~~ | ~~`/webhooks/storage/s3`~~ | **Removed.** A storage-side upload-complete callback is redundant under presign/confirm: `POST /documents/confirm` *is* the completion signal, and it is the one that carries the caller's identity, the `PendingUpload` authorization and the ingestion trigger. GCS can emit equivalent Pub/Sub notifications, but wiring them would create a **second, racing completion path** — one authenticated and authorized, one not — for the same event. If object-side notification is ever genuinely needed (detecting an upload that was presigned and never confirmed), it belongs as a reconciliation job, not a webhook that competes with confirm. | — |

---

## 7. GraphQL Surface (BFF)

REST stays the contract for uploads, webhooks, and streaming; GraphQL serves the dashboard's nested reads (tech-stack §3), with `DataLoader` batching to avoid N+1 across the service boundary.

**Queries:** `me`, `organization`, `departments`, `users(filter, page)`, `user(id)`, `roles`, `role(id)`, `permissions`, `tickets(filter, page)`, `ticket(id)`, `ticketMessages(ticketId, cursor)`, `documents(filter, page)`, `document(id)`, `ingestionJobs(filter, page)`, `ingestionJob(id)`, `analyticsOverview(range)`, `auditLogs(filter, page)`.

**Not built, and each for a stated reason**:

| Candidate | Why not |
| :---- | :---- |
| `chatConversations` | It is `tickets(source: CHAT, authorId: <caller>)`. **Both arguments** — `source` alone is the tenant-wide chat queue for an agent holding `ticket.read.all`, which is what `GET /chat/conversations` pins `authorId` to prevent. The `source` argument's schema description carries that, because the REST route's NAME used to |
| `knowledgeArticles` | Four scalar fields and no edges. GraphQL would buy field selection on a payload whose largest field is a title, and cost `GET` caching on a help centre's most cacheable read |
| `Role.users` | A reverse one-to-many with no `ListUsersByRoleIds` rpc. `userAssigned` is the count and `GET /users?roleId=` is the list; the batch RPC is not worth inventing for a screen that loads one role |
| `auth`, `otp`, `sessions` | Credential flows and commands. A GraphQL twin puts a reset token in a query document, and commands stay REST |
| `platform/*` | Super-Admin operator surfaces with no SPA behind them. Nothing composes them into a screen, which is the whole test |

**Mutations:** `createTicket`, `updateTicket`, `transitionTicketStatus`, `assignTicket`, `escalateTicket`, `sendTicketMessage`, `submitAiFeedback`, `createDepartment`, `assignUserRoles`, `assignUserDepartments`, `updateDocumentScoping`.

**Subscriptions:** `ticketUpdated(ticketId)`, `messageAdded(ticketId)`, `notificationReceived`.

**Field resolvers:** `Ticket.author`, `Ticket.assignee`, `Ticket.department` (resolved cross-service to `auth-service` via gRPC + DataLoader), `Ticket.aiSummary`, `TicketMessage.attachments`, `TicketMessage.citations` → `DocumentChunk`, `IngestionJob.document`, `Role.permissions`.

---

## 8. Service Ownership Map

| Gateway route group | Owning service | Transport |
| :---- | :---- | :---- |
| `/auth/*`, `/users/*` (incl. `/users/me`), `/organizations/*`, `/departments/*`, `/roles/*`, `/permissions`, `/platform/*` | `auth-service` | gRPC `auth.proto` |
| `/tickets/*`, `/chat/*`, `/messages/*/feedback`, `/attachments/*`, `/audit-logs/*`, `/users/me/tickets` | `ticket-service` | gRPC `ticket.proto` + NATS |
| `/notifications/*` | `notification-service` | gRPC `notification.proto` + NATS in |
| `/documents/*`, `/documents/flags/*`, `/ingestion-jobs/*` | `ingestion-service` | gRPC `ingestion.proto` + BullMQ |
| `/knowledge/*`, `/tickets/:id/ai/*`, `/tickets/:id/similar` | `rag-service` (Python) | gRPC `rag.proto` |
| `/billing/*`, `/webhooks/stripe` | `auth-service` | gRPC `auth.proto` — it owns `organizations`, and entitlements are columns on that row. A separate billing service would need write access to another service's table, which is the thing service-per-database exists to prevent |
| `/analytics/*` | fan-out (`ticket` + `ingestion` + `auth`) | gRPC, Redis-cached |
| `/ws` | `api-gateway` | Socket.IO + Redis adapter |
| *(no gateway route — internal only)* | `storage-service` | gRPC `storage.proto` + NATS in. Never called by the gateway directly; called server-to-server by whichever service owns the row a file belongs to ([ADR 0024](./decisions/0024-one-upload-mechanism.md)). |

### 8.1 NATS domain events

Per the todo note: **gRPC for synchronous cross-service reads, NATS for background triggers** (notifications, sends, side effects).

| Subject | Publisher | Consumers |
| :---- | :---- | :---- |
| `ticket.created` | ticket-service | rag-service (auto-classify), notifications, analytics |
| `ticket.escalated` | ticket-service | rag-service (build `ai_summaries`), notifications |
| `ticket.assigned` | ticket-service | notifications (create `notifications` + fan `notification_deliveries`), WS `ticket:assigned` event, audit |
| `ticket.reassigned` | ticket-service | notifications (reassignment alert + context), WS, audit, analytics (for workload tracking) |
| `ticket.unassigned` | ticket-service | notifications (if department queue needs attention), audit |
| `ticket.status_changed` | ticket-service | analytics, notifications |
| `ticket.message_created` | ticket-service | notifications (upsert grouped), WS fan-out, token metering |
| `document.uploaded` | ingestion-service | ingestion workers (BullMQ enqueue) |
| `document.indexed` | rag-service | ingestion-service (`status = INDEXED`), notifications, WS |
| `document.ingestion_failed` | rag-service | ingestion-service (`FAILED` + `error_log`), notifications, alerting |
| `document.deleted` | ingestion-service | rag-service (purge Qdrant points), notifications |
| `user.invited` · `user.locked` · `user.deleted` | auth-service | notifications (create delivery rows), session revocation |
| `notification.created` | notification-consumer | delivery-worker (fan to `notification_deliveries`, enqueue `email/sms` BullMQ jobs), WS fan-out to `user:{id}` |
| `audit.record` | any service (via `AuditPublisher`, `libs/common/src/contracts/audit.contract.ts`) | ticket-service (`AuditConsumer`) |
| `storage.object.superseded` | auth-service (avatar replace/clear), ticket-service (attachment delete), ingestion-service (document replace) | storage-service (async object delete) |
| `quota.exceeded` | any | notifications (CRITICAL priority, bypass quiet hours), platform alerting |
| `billing.entitlements_changed` | auth-service (Stripe webhook) | ingestion-service (invalidate the cached settings/tier for that tenant — a stale cache keeps a downgraded tenant on the premium model), analytics, audit |

---

## 9. Permission Code Registry (seed)

`permissions.code` uses `target.action` (RDM Table 6).

```txt
organization.read      organization.update    organization.delete
department.read        department.create      department.update      department.delete
department.member.assign
user.read              user.create            user.update            user.delete
user.invite            user.lock              user.role.assign       user.2fa.reset
user.session.read      user.session.revoke
role.read              role.create            role.update            role.delete
role.permission.assign
ticket.read.all        ticket.create          ticket.update          ticket.delete
ticket.assign          ticket.assign.self     ticket.reassign        ticket.escalate        ticket.resolve
ticket.export          ticket.ai.use          ticket.message.moderate
document.read          document.create        document.update        document.delete
document.share         document.reindex
analytics.read         audit.read             audit.export
```

**Default system roles** (`organization_id IS NULL`, `is_system_role = true`):

| Role | Grants |
| :---- | :---- |
| **Org Admin** | everything except `platform.*` |
| **Knowledge Manager** | `document.*`, `analytics.read`, `ticket.read.all` |
| **Support Agent (Tier 2)** | `ticket.*` (minus `delete`/`export`), `document.read`, `user.read` |
| **End User** | own tickets + `/chat/*` + `/knowledge/search` only (no explicit permission rows) |

---

## 10. Build Order

| Phase | Endpoints |
| :---- | :---- |
| **1 — Identity core** | `/auth/*` (register, login, refresh, logout, me), `/auth/password/*` + `/auth/email\|phone/verify*` (`password_reset_tokens`, `otps`), refresh-token rotation with `family_id` replay detection, and the expiry-pruning cron over `device_sessions` + `otps` + `password_reset_tokens`, `/users/me`, `/organizations/current`, `/departments/*`, `/users/*`, `/roles`, `/permissions` |
| **2 — Hardening** | 2FA, `/auth/sessions/*`, OAuth, invitations, lock/unlock, quota + lifecycle gates, `/audit-logs` |
| **3 — Helpdesk** | `/tickets/*`, `/tickets/:id/messages`, attachments, status machine, assignment, `/ws` chat |
| **3b — Notifications (Domain E)** | `/notifications/*` (§4b), the `notifications`/`notification_deliveries`/`notification_preferences` schema, the NATS consumer that creates rows from `ticket.*` events, and the `notification:*` WS events. **Runs alongside phase 3, not after it** — every phase-3 event (`ticket.assigned`, `ticket.message_created`) already specifies "→ notification" in §8.1, so shipping the helpdesk without this means shipping events with no consumer. `notification-service` today handles only fire-and-forget email/SMS and owns no database; the feed needs one. |
| **4 — Knowledge** | `/documents/*`, `/ingestion-jobs/*`, department scoping |
| **5 — AI** | `/knowledge/search` · `/ask`, `/chat/*`, `/tickets/:id/ai/*`, streaming, cost metering (`ai_generations` + the Redis counter), `/feedback`. **The settings layer ships with this phase, not after it** — every model choice reads `settingsFor(orgId)` from day one, because retrofitting it means auditing every LLM call site in two languages ([ADR 0007](./decisions/0007-settings-layer-owns-model-names.md)) |
| **5b — Billing** | `/billing/*`, `/webhooks/stripe`, the entitlement writer, `billing_events` ([ADR 0026](./decisions/0026-stripe-webhook-idempotency.md)). After phase 5 because cost metering must exist before a plan can grant an AI budget that means anything |
| **5c — AI tiers** | `ai_model_tier` wired into the settings layer and mapped from Stripe price ids. One column and one mapping, *because* 5 built the indirection and 5b built the writer |
| **6 — Insight** | `/analytics/*`, `/platform/*`, GraphQL layer, exports |

---

## 11. Open Decisions

**All resolved** (see details in RDM §2 Tables 23–27 and `docs/schema-corrections.md`):

1. ✅ **Ticket categories** — Resolved by removing `ticket_categories` table (simplification). **Departments ARE the category taxonomy.** Replaced with `ticket_assignments` (RDM Table 26) to track full lifecycle: who held each ticket, when, which department, and why reassigned. This provides the missing assignment audit trail (INITIAL | ESCALATION | SKILL_MISMATCH | WORKLOAD_BALANCE | REASSIGNMENT).

2. ✅ **Notifications persistence** — Resolved as three-table schema (RDM Tables 23–25): `notifications` (feed + read/archive state), `notification_deliveries` (multi-channel send tracking), `notification_preferences` (per-type/channel opt-in + digest batching). Phase 3 blocking.

3. ✅ **KB articles** — Resolved by omission. Dropping `/knowledge/articles` endpoints; recommendation surfaces document chunks + similar tickets via `/tickets/:id/ai/suggestions`. If curated content is needed later, add `documents.source_type = AUTHORED` and funnel through the same ingestion/chunk/embed/cite pipeline.

4. ✅ **Ticket channel** — Resolved by adding `tickets.source ENUM (WEB | CHAT | EMAIL | API)`. Unblocks `/analytics/volume` and `/analytics/deflection` breakdowns by channel. Phase 3.

5. ✅ **`documents/stale` detection** — Resolved as `document_flags` table (RDM Table 27) with `flag_type ∈ { OUTDATED | UNRETRIEVED | UNCITED | LOW_CONFIDENCE | NEGATIVE_FEEDBACK | CONFLICTING }`. Heuristics ship in phase 4 and read `document_chunks` usage counters, **not** the ledger, which is retention-rolled; LLM conflict detection (CONFLICTING) in phase 6 with scheduled batch jobs. `UNRETRIEVED` (never once retrieved) and `UNCITED` (retrieved repeatedly, never cited) were originally one flag under a name that fit only the first.

6. ✅ **Invitation persistence & email scoping** — `/users/invitations` had no backing table, and `users.email` was globally `UNIQUE`, which made one human equal to one tenant forever: contractors could not be invited, and soft-deleting a user locked their address permanently. Resolved by (a) scoping email uniqueness to `(organization_id, email)` via two partial indexes filtered on `deleted_at IS NULL` (RDM §1.10, Table 3), and (b) adding `user_invitations` (RDM Table 28). Costs a tenant-disambiguation step on login (`POST /auth/login/tenant`). Both halves are **implemented**; the reasoning is preserved in [ADR 0020](./decisions/0020-email-uniqueness-is-per-tenant.md).

**Previously resolved:** password reset and email/phone verification tokens now have first-class tables — `password_reset_tokens` and `otps` (RDM §1.9, Tables 11–12) — so no stateless-JWT fallback is needed.
