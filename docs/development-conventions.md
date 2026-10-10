# Development Conventions

**Audience:** every developer writing code in this repository.
**Scope:** the TypeScript services and `packages/`, and the gateway's contract suite (§13.4b). The gateway itself is the Spring Boot application in `services/api-gateway/`; its source is held by the specs that scan it, not by rules written here. Rules and examples only. Current state lives in [`reference/`](./reference/), reasoning lives in [`decisions/`](./decisions/). See [README.md](./README.md).

Read §1 and §2 before your first commit. Use §14 as a pre-PR checklist.

Wording is deliberate:

- **MUST / MUST NOT** — a reviewer should block the PR.
- **SHOULD** — deviate only with a comment saying why.
- **MAY** — genuine discretion.

Every rule here exists because getting it wrong produces a failure that is *silent*. Loud failures don't need conventions; the compiler catches those.

---

## 1. The Golden Rules

1. **Search `packages/` before you write a helper.** If two services need it, it belongs in a shared package — `contracts`, `core`, `nest-common` or `grpc-proto` — not copied. (§3)
2. **Never trust the client for identity or tenancy.** `user_id`, `organization_id`, `department_ids` and `permission_codes` come from the verified JWT, which the gateway forwards as gRPC metadata — never from a path, body or query. (§4)
3. **Never trust the client for provenance either.** `ip` / `userAgent` are *observed* by the gateway (`RequestOrigin`), never claimed by the caller. (§4.3)
4. **Every Prisma query on a soft-deletable table filters `deletedAt: null`.** Prisma cannot do this for you. (§7.1)
5. **Every unique constraint on a soft-deletable table is enforced in code, not in the schema.** (§7.2)
6. **Never declare an `enum` in `schema.prisma`.** Enumerated columns are `String`; the values live in `@synapsedesk/contracts`. (§7.3, [ADR 0001](./decisions/0001-no-prisma-enums.md))
7. **Choose the hash by how the value is looked up**, not by habit. (§8.1)
8. **Production must be silent.** No internals, no stack traces, no "requires permission X" hints past the gateway boundary. (§8.4)
9. **gRPC for reads, NATS for side effects.** A mail outage must never fail a registration. (§6, §9)
10. **Reset test state in `beforeEach`, and match the strategy to whether the service has seeded rows to preserve.** (§13.3)

---

## 2. Architecture & Layering

**Ownership holds even before a service exists.** A table belongs to the service that owns its domain, whether or not that service is built yet — `audit_logs` belongs to `ticket-service`, so Domain A *publishes* audit events rather than growing its own table. Writing a table into the wrong service is a migration problem later, not a shortcut now.

### 2.1 Layering inside a service

```txt
service:   *-grpc.controller.ts ──> *.service.ts ──> PrismaService
                                        │
                                    mapper: Prisma row -> proto
```

- A service **`*-grpc.controller.ts` MUST be a thin adapter**: unpack metadata, delegate, return the proto message. No queries, no branching.
- A service **`*.service.ts` MUST NOT know about HTTP.** It throws `RpcException` with a gRPC `status`, never `BadRequestException`. (§6.4)
- **`packages/` MUST NOT import from `services/` or `apps/`.** Ever.
- **`@synapsedesk/contracts` and `@synapsedesk/core` MUST NOT import a Node built-in, NestJS, gRPC or any other server package**, `import type` included — a browser imports them. `core` may import `contracts`, and nothing else of ours. `browser-safe.spec.ts` holds both. `packages/grpc-proto` is where the wire lives.
- **A provider that holds a connection MUST be an `@Injectable` class implementing `OnModuleDestroy`, registered with `useClass`.** Nest calls lifecycle hooks only on providers it instantiated from a class; a value returned by `useFactory` is just a value, so implementing the interface on it does nothing and no warning is issued. The connection is then never closed on `app.close()` — one leak per restart in production, and a test run that passes and then hangs with no output. `PendingUploadStore` in `services/storage-service/src/modules/storage/pending-upload.store.ts` is the reference.

### 2.2 Where a new file goes

| You are adding… | Put it in |
| :--- | :--- |
| A type or constant two services need | `packages/contracts/src/configs/*.config.ts` |
| A NATS message shape | `packages/contracts/src/contracts/*.contract.ts` |
| A pure function two services need | `packages/core/src/utils/` |
| Server code two services need — NestJS, NATS, Redis | `packages/nest-common/src/` |
| A helper the test suites share | `packages/testing/src/` |
| A guard that reads the repository | `packages/config/src/` |
| A proto enum ↔ domain enum bridge | `packages/grpc-proto/src/mappers/` |
| A gRPC DI token / path / channel option | `packages/grpc-proto/src/constants.ts` |
| A pure function used by one service only | `apps/<svc>/src/common/utils/utils.ts` |

---

## 3. Shared Libraries — Use Them

These libraries exist so services agree with each other on the wire and on shared domain values. Each package's entry point is its `src/index.ts`: `contracts`, `core`, `nest-common` and `grpc-proto`.

Import by package name, **never by relative path across app boundaries**:

```ts
import { RequestContext, PermissionCode } from '@synapsedesk/contracts';
import { toTimestamp, GRPC_DEADLINE_MS } from '@synapsedesk/grpc-proto';
```

**MUST NOT:** hand-roll a `new Date(seconds * 1000)`, write a `{ seconds, nanos }` literal, cast a proto enum to a domain enum, or build a bare `new Metadata()` outside `packages/grpc-proto`.

**MUST:** call `normalizeEmail()` (`@synapsedesk/core`) at every email entry point. One path that skips it makes `JOHN@acme.com` a second account.

### 3.1 Adding to a shared library

1. Confirm a **second** consumer exists or is imminent. One consumer ⇒ keep it local.
2. Add it to the owning module and export from the entry point (`main.ts` / `index.ts`).
3. Document *why it is shared* in the docblock, not what it does.

### 3.2 `as const` or an explicit element type — decided by which one is the source

A constant array is one of two things, and the shape follows from which:

| The array is | Shape | Because |
| :--- | :--- | :--- |
| The **source** of a union type | `as const` | `(typeof X)[number]` only narrows if the literals are preserved — `PERMISSION_CODES`, `OCR_LANGUAGES` |
| A **subset** of a union that already exists | `readonly T[]` | The union is the source; annotating with it is what makes a wrong member a compile error — `NON_LATIN_OCR_LANGUAGES: readonly OcrLanguage[]` |
| Both — a subset whose members must also stay literal | `as const satisfies readonly T[]` | `ALLOWED_DOCUMENT_MIME_TYPES` |

Same rule for a scalar: `const CHEAP_MODEL: AiModel = '…'` when the union exists, so a typo is caught where it is written rather than where it is used.

**A field typed `string` where a union exists is a bug, not a style choice** — it is the shape that lets a value be filtered out or silently defaulted downstream. Narrow at the boundary by *parsing*, never by casting at the point of use: a cast moves the failure, a parse removes it (`parseOcrLanguages`).

---

## 4. Multi-Tenancy, Identity & Request Scoping

### 4.2 Tenant isolation

- `organizationId === null` means **platform Super Admin** (`is_super_admin = true`), kept in lockstep by a DB CHECK constraint. It does *not* mean "no tenant".
- Every query touching a tenant-scoped table **MUST** filter by the caller's `organizationId`, except when `isSuperAdmin`.
- Cross-tenant reads via a resource id **MUST** go through `RequestContextService.validateOrganizationScoping()`.
- The gateway **MUST NOT** accept `organizationId` as client input. Sole exception: `/platform/*`, where the tenant is an explicit path segment and `SUPER` is required.
- Scoping is **entirely manual** — there is no Prisma middleware ([known-gaps](./reference/known-gaps.md) #1). Treat a missing `organizationId` filter as a security bug in review.

### 4.3 Provenance

`RequestOrigin` (`{ ip, userAgent }`) is what the gateway *observed*. It is written to `device_sessions`, `password_reset_tokens` and `audit_logs`.

- For a background job with no real request, use the frozen shared `UNKNOWN_ORIGIN`, not an inline `{ ip: '', userAgent: '' }`.

### 4.4 Entitlements and limits — every layer narrows, no layer widens

Four things can bound one operation: a **platform ceiling** (a code constant), the **plan grant** ([RDM Table 40](./rdm-spec.md)), the grant **denormalized onto the tenant**, and the tenant's own **override**. The effective limit is the `min()` of all of them.

- **Read the `min()`, never one layer.** A reader that trusts the plan column alone ignores a tenant that narrowed itself; one that trusts the override alone ignores the plan. Compose at the read site.
- **A plan may only narrow.** The platform ceiling protects a parser or a transport, and is not sellable — so a plan column is an argument to `min()`, never a replacement for it. Selling more than the platform admits must stay unexpressible.
- **An override above the ceiling is REFUSED, not clamped.** Clamping accepts a request that asked for a self-service entitlement grant and silently gives less; the edge must 400.
- **A plan grant is `NOT NULL`; a tenant override is nullable.** A subscription always grants a value, so a blank grant is a bug. `NULL` on an override means "the tenant configured nothing", which is the normal state — the two nullabilities carry different meanings and must not be unified.
- **Denormalize the grant onto the tenant row.** Enforcement paths read one row; joining the catalogue on every presign puts it in the hot path of the highest-volume route in the system.
- **The direction of dial-out is fixed: `ingestion-service` calls `auth-service`, never the reverse.** Auth owns the limits, ingestion owns storage and document counts, and neither can produce a whole verdict — the **gateway** composes the legs and reports **which dimensions each run actually covered**. An unevaluated dimension and an evaluated-and-clear one are different answers; collapsing them lets a downgrade through on a timeout.
- **Adding a dimension is five edits, not one:** the plan column, the denormalized tenant column, the `min()` at every read, the composer's coverage list, and [rdm-spec.md](./rdm-spec.md). A dimension added to only the first two enforces nothing.

---

## 6. gRPC Conventions

### 6.1 Contract first

`.proto` files live in `packages/grpc-proto/src/proto/<package-path>/`. Change the proto → `npm run proto:generate` → fix both ends. **Never hand-edit `src/generated/`.**

- The directory path **MUST** equal the package name with dots as slashes: `package synapsedesk.auth` ⇒ `proto/synapsedesk/auth/`. `buf lint` enforces this. Protobuf's type namespace is flat and global, so a bare `package auth` claims that name process-wide.
- Tooling is `buf` (an npm devDependency), **not** a system `protoc`.

| Command | Does |
| :--- | :--- |
| `npm run proto:generate` | Regenerates `src/generated/` per `buf.gen.yaml` |
| `npm run proto:lint` | Enforces the layout + naming rules in `buf.yaml` |
| `npm run proto:breaking` | Diffs the wire contract against `main` |

The package is deliberately **unversioned** (no `.v1`), so there is no v2-beside-v1 escape hatch. `proto:breaking` is the only thing between an edit and a wire-incompatible deploy — keep it in CI.

### 6.2 Bootstrap

Server (`main.ts`) and client (`ClientsModule.register`) **MUST** both pass `GRPC_LOADER_OPTIONS` and spread `GRPC_CHANNEL_OPTIONS`, using `AUTH_PACKAGE_NAME` / `AUTH_PROTO_PATHS` from the lib.

### 6.4 Errors across the boundary

Services throw `RpcException({ code: status.X, message })`. The gateway maps:

| gRPC status | HTTP | Use for |
| :--- | :--- | :--- |
| `INVALID_ARGUMENT` / `FAILED_PRECONDITION` / `OUT_OF_RANGE` | 400 | bad input, wrong state |
| `UNAUTHENTICATED` | 401 | bad credentials |
| `PERMISSION_DENIED` | 403 | authenticated but not allowed |
| `NOT_FOUND` | 404 | missing resource |
| `ALREADY_EXISTS` / `ABORTED` | 409 | uniqueness, illegal transition |
| `RESOURCE_EXHAUSTED` | 429 | quota, OTP attempts exhausted |
| `UNAVAILABLE` | 503 | peer down |
| `DEADLINE_EXCEEDED` | 504 | peer too slow |

**An unmapped status becomes a 500 and is logged as a bug.**

### 6.5 proto ↔ domain conversion

Mappers live in `packages/grpc-proto/src/mappers/`, named per §12.1.

- `Timestamp` is `{ seconds, nanos }`. Use the mappers.
- ts-proto types every **message-valued** field as `T | undefined`. That is its convention, **not** permission to omit them. For a non-optional proto field use **`requireProtoTimestamp(v, 'field')`**.
- Protobuf has no `null`; unset arrives as `undefined`. REST commits to `null`. Convert **deliberately, field by field, in the mapper** (`?? null`) so the JSON key set is stable for clients and OpenAPI.
- proto3's zero value means "omitted". An enum's `*_UNSPECIFIED` member **MUST** be rejected rather than defaulted to a real value.
- **Proto enum members are prefixed with the enum name** (`GENDER_MALE`, not `MALE`) — a hard protobuf constraint (§12). Domain enums stay unprefixed (`Gender.MALE`); the mapper pair is the only bridge.
- `UNRECOGNIZED` (-1) means a newer build sent a member this one doesn't know. Treat it as unspecified, never crash.
- The two directions are **deliberately asymmetric** — see [ADR 0004](./decisions/0004-mappers-name-the-foreign-side.md).

---

## 7. Prisma & Data Access

Schema is source of truth; reset freely. Do **not** hand-write migration SQL for ordinary changes. **This is the development answer** — production applies schema through `prisma migrate deploy` ([ADR 0042](./decisions/0042-schema-reaches-production-through-migrate-deploy.md)), because `db push` creates a missing database on a typo, refuses data-losing changes at the moment of deploy, and records no history.

What Prisma cannot express — partial indexes, `CHECK` constraints, composite GIN over a `tsvector`, extensions — goes in the owning service's seeder DDL block (`apps/*/src/modules/prisma/database.seeder.ts`, `applySchemaObjects`), as `CREATE … IF NOT EXISTS`, with a comment saying what invariant it holds. That method runs in the **deploy step**, not on application boot, and is not behind `SEED_ON_BOOTSTRAP` — the flag gates seed ROWS, and only auth-service has any. Two callers reach it and you need both: `npm run db:push` chains `db:schema` here, and the `migrate` init container runs the same entrypoint after `migrate deploy` there ([ADR 0043](./decisions/0043-the-cluster-shape.md)). **`prisma db push` alone leaves you a database with every table and none of these objects**, which boots and serves and passes the seeder's own `assertSchemaExists()` check — that check counts tables. If you push by hand, run `npm run db:schema -w @synapsedesk/<service>` after it.

**Once a migration exists, it may expand or contract but not both** — a column is dropped in the release AFTER the one that stopped reading it, and a rename is add-copy-switch-drop across two ([ADR 0044](./decisions/0044-expand-and-contract-never-in-one-release.md)). Prisma has no down-migrations, so the only rollback this system has is `kubectl rollout undo` on the code, and that is safe only while the previous image's expectations are a subset of the current schema. *"Reset freely"* above is the development answer and stays true there; a local database has no rollback to protect.

**That block is the list.** This section deliberately names none of them: it used to name two, and the seeders had grown to twenty-one — one of the two having never been applied at all (known-gaps row 5). A prose enumeration of database objects has nothing that fails when it drifts. See [ADR 0039](./decisions/0039-the-seeder-ddl-block-is-the-list.md).

### 7.1 Soft deletes

Soft-deletable: `organizations`, `departments`, `users`, `documents`, `tickets`.

- **Every** read **MUST** include `deletedAt: null`. There is no global Prisma filter.
- `DELETE` handlers set `deletedAt` + `deletedById`. Never `prisma.x.delete()` on these tables.
- `includeDeleted=true` is admin-only and gated by the matching `*.manage` permission.
- Credential child tables (`otps`, `password_reset_tokens`, `device_sessions`, `two_factor_backup_codes`) **do** hard-delete via `onDelete: Cascade`.

### 7.2 Uniqueness + soft delete — the trap

`@unique` is a **database-wide** constraint that knows nothing about `deletedAt`. So soft-deleting `alice@acme.com` **blocks re-registration of that address forever**, and "unique among active rows" **cannot** be expressed as `@unique`.

**Therefore:** for every unique field on a soft-deletable table, the service layer **MUST** own the check — query with `deletedAt: null`, decide, and handle the race (`P2002`) explicitly. Where "unique among active" is the real rule, use a **partial unique index** in migration SQL, as `user_departments` does for `is_primary`.

**But "unique among active" is not always the real rule, and the deciding question is: DOES THE ROW COME BACK?** Both answers appear in `auth-service`, and reading the trap in only one direction gets the other one wrong:

| | Restorable? | Index | Why |
| :--- | :--- | :--- | :--- |
| `organizations.slug` | **Yes** — `restoreOrganization` un-deletes a tenant in place and it keeps its slug | full `@unique` | The name must stay RESERVED while offboarded. A partial index would let a new tenant claim `acme` in the meantime, and the restore then fails — or worse, succeeds and leaves two live tenants answering one URL. |
| `subscription_plans.name` | **No** — a retired plan is never un-retired | partial, `WHERE deleted_at IS NULL` | Reuse is wanted. A full `@unique` would block ever creating another plan called "Pro", permanently, over a row every read filters out. |

Same trap, opposite conclusions. Ask whether anything un-deletes the row before choosing: a partial index on a restorable row is a restore that fails later, and a full `@unique` on a non-restorable one is a name burned forever.

**Adding a NOT NULL column to a SEEDED table is a backfill, not a push.** A grant column carries no `@default()` by design — the point is that every create answers "what does this get" at compile time — and `prisma db push` refuses to add a required column with no default to a table that already has rows. The catalogue tables are seeded, so **every grant added from now on has this shape**: add the column with a temporary default, backfill the existing rows, then `DROP DEFAULT` so the column matches the schema.

**And verify it landed in EVERY database, not the one the suite uses.** Measured: the same push succeeded against the test database (its table was empty) and refused against dev, and the command's own summary said "in sync". An e2e assertion cannot catch that divergence — it only ever connects to one of the two. `npm run db:verify` checks both.

### 7.3 No enums in `schema.prisma` — ever

**MUST NOT** declare an `enum` block in any `schema.prisma`. Full reasoning: [ADR 0001](./decisions/0001-no-prisma-enums.md).

```prisma
// ✗ NEVER
enum InvitationStatus { PENDING  ACCEPTED  REVOKED  EXPIRED }
model UserInvitation {
  status InvitationStatus @default(PENDING)
}

// ✓ ALWAYS
model UserInvitation {
  /// InvitationStatus in @synapsedesk/contracts. Deliberately a String, not a
  /// Prisma enum — see development-conventions §7.3.
  status String @default("PENDING") @db.VarChar(50)
}
```

```ts
// packages/contracts/src/configs/auth.config.ts — the single source of truth
export enum InvitationStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REVOKED = 'REVOKED',
  EXPIRED = 'EXPIRED',
}
export const INVITATION_STATUSES = Object.values(InvitationStatus);
```

Because the database does not enforce the set, the service layer **MUST**:

- Validate at every write — `@IsEnum()` on the REST edge, the mapper on the gRPC edge.
- Prefer the **proto enum** as the outer gate wherever a value crosses the wire.
- Type the Prisma read side back into the domain enum at the mapper boundary (`row.status as InvitationStatus`).
- Validate the **transition**, not just the value, for any state machine.

**Values are `SCREAMING_SNAKE_CASE`, with no exceptions.**

#### `enum` or `as const`? Ask what the value IS

- **A persisted domain value gets an `enum`** — `InvitationStatus`, `AuditAction`, `NotificationChannel`. It is written to a column, crosses the wire as a proto enum, and the enum is the single declaration both ends read.
- **A key namespace or a wire-literal map gets `as const` plus a derived union** — `CACHE_SCOPES`, `REALTIME_EVENTS`, `CLIENT_EVENTS`, `GRPC_PEERS`. These are matched literally by a client or used to build a cache key, so the union must accept a plain string literal, which a TypeScript `enum` does not.

```ts
export const CACHE_SCOPES = { permissions: 'permissions', … } as const;
export type CacheScope = (typeof CACHE_SCOPES)[keyof typeof CACHE_SCOPES];
```

**MUST** — a `'a' | 'b'` union that appears in two signatures gets a name. `EntityScopeKind` exists because `entityScope()` and `entityFromParam()` both took it inline, and the second copy is the one that stops matching when a third entity appears.

### 7.4 Query hygiene

- `select` the fields you need. `SELECT *` on `users` drags `password_hash` and `two_factor_secret` into memory.
- Multi-write invariants go in `prisma.$transaction` (`OtpService.issue()` is the reference).
- Filter on the DB, not in JS. `expiresAt: { gt: new Date() }`, not fetch-then-filter.

---

## 8. Security

### 8.1 Hashing — pick by lookup pattern, not by habit

| Value | Hash | Column | Why |
| :--- | :--- | :--- | :--- |
| `users.password_hash` | **Argon2 / bcrypt** | VarChar(255) | Low-entropy human secret; slowness is the defence |
| `device_sessions.refresh_token_hash` | **SHA-256 hex** | VarChar(64) | `@unique`, looked up **by value** |
| `device_sessions.device_token_hash` | **SHA-256 hex** | VarChar(64) | same |
| `password_reset_tokens.token_hash` | **SHA-256 hex** | VarChar(64) | same |
| `otps.code_hash` | **scrypt, salted** | VarChar(255) | Found via `(user_id, purpose)` index, **not** by value |
| `two_factor_backup_codes.code_hash` | **scrypt, salted** | VarChar(255) | Found via `user_id`, not by value |

**The rule:** a randomly-salted hash (bcrypt/Argon2) produces a different digest every time, so it can never be found by an indexed equality lookup. Any secret stored in a `@unique` column that arrives from the client and must be *found* therefore uses `hashToken()` (SHA-256) — those tokens are 256 random bits, and slow KDFs exist to protect *guessable* secrets.

The converse holds: `otps.code_hash` and `two_factor_backup_codes.code_hash` are not looked up by value, so they are free to use a slow KDF — and a 6-digit code is exactly the low-entropy case that warrants one. Both use `hashCode()` (scrypt, `N=2^14, r=8, p=1`, random 16-byte salt), which is what `VarChar(255)` was sized for: the stored string is `scrypt$N=…,r=…,p=…$<salt>$<key>`, carrying its own parameters so a later change can still read older rows.

`verifyCode()` reads both formats — a stored value with no `$` is a pre-scrypt SHA-256 digest, and backup codes issued before the switch stay valid for `BACKUP_CODE_TTL_DAYS`. It returns `false` on anything it cannot parse rather than throwing, because this runs where a throw would read as a server error on a merely wrong code.

Compare digests with `safeCompareHex()` or `verifyCode()`, **never `===`**.

### 8.2 Generating secrets

- `generateSecureToken()` — 32 bytes, `base64url`.
- `generateNumericCode(n)` — `randomInt` per digit, zero-padded. **Never `Math.random()`**, and never format a single `randomInt(0, 1e6)` — a leading zero gets dropped one time in ten.
- `generateBackupCodes(n)` — deduplicated via a `Set`.
- TOTP secrets are AES-256-GCM encrypted at rest, key stretched from `TWO_FACTOR_MASTER_KEY` via scrypt. The scrypt salt is fixed on purpose — the key must be reproducible across replicas.

### 8.3 Never log or return

`password_hash`, `two_factor_secret`, any `*_token_hash`, any `code_hash`, raw OTP codes, reset tokens, full email/phone in a pre-auth response.

Mask instead: `maskEmail()` (`a***e@acme.com`), `maskPhoneNumber()` (`+44******0123`).

### 8.4 Production silence

`NODE_ENV === 'production'` **MUST** gate:

- `AllHttpExceptionFilter` → `'Internal server error'` instead of the real message.
- `PermissionGuard` → generic 403 instead of `Requires one of: …`.
- `LoggingInterceptor` → no per-request line. **Errors are always logged.**

New code following this pattern takes `isProduction` as a constructor arg — global filters/interceptors are built with `new` in `main.ts`, outside DI.

### 8.5 A model's output is UNTRUSTED INPUT

**It gets the same treatment as a request body:** parsed defensively, validated against a known set where one exists, defaulted toward *less* confidence, and never allowed to reach a `throw`. Every parse site returns a safe empty rather than raising. **A generation that produced unusable output still cost money and is still ledgered.**

It belongs here rather than in a RAG document because it is the input-validation rule with a different source. Parse-site defaults and the Markdown answer contract: [reference/ai-output-contract.md](./reference/ai-output-contract.md).

### 8.6 Enumeration & timing

- `POST /auth/password/forgot` always returns 202. Same for any "does this account exist" surface.
- Failed login **MUST NOT** distinguish "no such user" from "wrong password".

---

## 9. NATS Conventions

Subjects and payloads live in `packages/contracts/src/contracts/*.contract.ts` as **discriminated unions**. NATS is untyped on the wire: a publisher that renames a field fails *silently* — the message is delivered, the consumer reads `undefined`, and the email goes out saying "Hello undefined". Both ends importing the same declaration turns that into a compile error.

- Fire-and-forget for side effects, never request/response: `emit()` on the core transport, `JetStreamPublisher.publish()` on the durable subjects.
- **MUST NOT** `await` a notification publish in a request path.
- A new template means a new arm of `SendEmailCommand` with its own required `data` fields — **not** a `Record<string, unknown>` bag.
- Publishing services hold **no** Resend or Twilio credentials. Those belong to `notification-service` alone (the gateway's receiving key is a different key with a different scope).

**Two transports, and which one a subject uses is a decision, not a default.** `DURABLE_SUBJECTS` in `jetstream.config.ts` is the list; everything else is core NATS at-most-once. The rule for adding to it is [ADR 0041](./decisions/0041-durable-subjects-are-the-ones-with-nothing-to-reconcile-against.md): *prefer reconciliation where state exists, redelivery where it does not.*

- A durable subject **MUST** have a duplicate-safe consumer before it is made durable. At-least-once converts "lost" into "possibly twice", so promoting a subject in front of a consumer that cannot absorb a duplicate is a downgrade, not an upgrade.
- Publish dedupe (`Nats-Msg-Id` inside `duplicate_window`) and consumer idempotency (a unique index) defend **different** failures. A test of one does not cover the other, and they are easy to conflate — a test publishing the same body twice passes either way.
- A durable handler has **three** outcomes, not two. Rethrow a *transient* failure so the runner naks it; return for a malformed payload worth dropping; throw `UnprocessableMessage` for one that is unrecoverable but worth keeping, which parks it immediately. Retrying a failure that cannot succeed is the poison loop `MAX_DELIVER` exists to bound, entered deliberately.
- Redelivery needs **both** pacing mechanisms configured, because they cover different failures: `nak(ms)` for a handler that failed and said so, the consumer's `backoff[]` for one that died without answering. Setting only `backoff` leaves an explicit nak firing every retry in milliseconds — and it is accepted into the config and reported by `nats consumer info` while doing nothing, so it looks configured.
- No `backoff` entry may be shorter than a handler's slowest legitimate run: **each one replaces `ack_wait` for that attempt**, so a short entry redelivers a message still being processed.
- Nest's NATS transport is **core-only**. `@EventPattern` never sees a JetStream message; durable subjects are consumed by a `PullConsumerRunner` started in `main.ts`.
- Both **publishers and consumers** call `ensureStream`. A publish to a subject no stream captures fails with a 503, so a publisher that assumes someone else declared it loses everything published before that service boots.

---

## 10. Configuration

- Every env var **MUST** be declared in the service's `common/config(s)/env.validation.ts` Joi schema.
- Read with `getOrThrow<T>()`, never `process.env.X` in application code, and **read once in the constructor** into a `private readonly`.
- Magic numbers and literal unions go in a topic-named `common/config(s)/<topic>.config.ts`, not inline. Cross-service values go in `packages/contracts/src/configs/<topic>.config.ts`.
- `.env` is git-ignored. **Every service MUST ship an `env.example`** (plus `serviceAccountKey.json.example` where applicable).
- The only pre-`ConfigModule` `process.env` reads are in `main.ts`, where transport options are computed before DI exists.

---

## 11. Error Handling & Logging

- `formatErrorMsg(err)` normalizes anything throwable to one trailing `!`. Use it rather than `err.message`, which is `undefined` for non-`Error` throws.
- One `Logger` per class: `private readonly logger = new Logger(Foo.name)`.
- Levels: `debug` = dev aid; `warn` = suspicious but handled; `error` = a bug or failed dependency, with the stack.
- Security-relevant events **MUST** be logged at `warn` or above *and* written to `audit_logs`.
- **MUST NOT** swallow an error to satisfy a type. If it is genuinely ignorable, comment why.

---

## 12. Naming & Layout

| Thing | Convention | Example |
| :--- | :--- | :--- |
| File | `kebab-case.<role>.ts` | `pending-upload.store.ts`, `user.mapper.ts` |
| Service gRPC entry | `<domain>-grpc.controller.ts` | `auth-grpc.controller.ts` |
| Scheduled job | `<subject>-<verb>.job.ts` | `invitations-expiry.job.ts` |
| Seeder | `<scope>.seeder.ts` | `database.seeder.ts` |
| Wire ↔ domain mapper | `<entity>.mapper.ts` | `user.mapper.ts` |
| **Mapper, outbound** | **`to<ReturnTypeName>`** — destination type's name verbatim, suffix included | `toDepartmentResponse`, `toProtoTimestamp` |
| **Mapper, inbound** | **`from<InputTypeName>`** — the *source* type's name, verbatim | `fromProtoGender`, `fromProtoOrgStatus` |
| Mapper, inbound + required | `require<InputTypeName>` — throws where `from*` would return `undefined` | `requireProtoTimestamp` |
| NATS payload types | `*.contract.ts` | `notification.contract.ts` |
| `.proto` file | `lower_snake_case.proto` — **underscores, not hyphens** | `two_factor.proto` |
| proto package | `synapsedesk.<service>`, no version suffix (§6.1) | `synapsedesk.auth` |
| proto directory | Mirrors the package, dots → slashes | `proto/synapsedesk/auth/` |
| proto enum member | `<ENUM_NAME>_<VALUE>` — **required** | `GENDER_MALE`, `OTP_PURPOSE_UNSPECIFIED` |
| Class | `PascalCase` + role suffix | `PendingUploadStore` |
| DI token | `SCREAMING_SNAKE` `Symbol` | `AUTH_GRPC_CLIENT` |
| Permission code | `target.action` | `ticket.assign.self` |
| DB table / column | `snake_case` via `@map` | `refresh_token_hash` |
| Prisma field | `camelCase` | `refreshTokenHash` |
| Enumerated column | `String @db.VarChar(50)` — **never** a Prisma `enum` (§7.3) | `status String @default("PENDING")` |
| Enum value | `SCREAMING_SNAKE`, stored verbatim | `SUSPENDED_PAST_DUE` |
| NATS subject | `dot.separated.lowercase` | `notification.email.send` |
| Audit action | `SCREAMING_SNAKE` past tense | `PASSWORD_RESET_COMPLETED` |

**Proto enum members are prefixed because protobuf uses C++ scoping** — enum values are *siblings* of their type, so they must be unique across the whole **package**. Two enums both declaring a bare `UNSPECIFIED` is a hard compile error. `buf lint`'s `STANDARD` ruleset catches it before protoc does.

### 12.1 Mappers

- **`to<ReturnTypeName>` / `from<InputTypeName>` always name the FOREIGN side.** `toUser` is the version this rule exists to prevent. Full reasoning: [ADR 0004](./decisions/0004-mappers-name-the-foreign-side.md).
- **A GENERIC wrapper return type has no single name to carry verbatim**, so the rule above has no answer for it, and `mapper-naming.spec.ts` exempts a return type containing `<`.
- **An ARRAY return pluralizes the type's name, not the suffix**: a mapper returning `<Type>[]` is `to<Type>s`, with the type's suffix intact. Dropping the suffix is the common way this rule fails, because the shorter name reads perfectly well and stops identifying what it returns.
- **`mapper-naming.spec.ts` enforces all of this**, scanning `*.mapper.ts` from the CODE toward the rule. Six violations reached `main` before it existed and every one was found by somebody happening to open the file — a reviewer sees the mapper in their diff and nothing reads the rest.

### 12.3 Docblocks vs comments — they are different tools

| | Docblock `/** */` | Comment `//` |
| :--- | :--- | :--- |
| **Answers** | What is this, how do I use it? | What must I not get wrong *here*? |
| **Audience** | The caller — reads it on hover, never opens the file | Whoever edits this line next |
| **Contains** | Description, usage, `@example`, `@param`/`@returns`/`@throws`, links to related symbols | A trap, a non-obvious constraint, a reason this line is not the obvious one |
| **Sits on** | The declaration — function, class, method, type, constant | The statement or expression it is about |

**MUST** — every exported symbol gets a docblock whose **first line says what it is**, in one sentence.

**MUST NOT** — put change history, migration notes, or "why this approach and not that one" in a docblock. That belongs in the commit message, the PR, or an ADR in [`decisions/`](./decisions/). A reader hovering a function wants its contract, not its biography.

**SHOULD** — put a genuine trap at the line it applies to, as a `//` comment, short enough to read in one pass.

**MUST NOT** — start a doc line with a bare `@`. TypeScript's JSDoc scanner opens a block TAG at any `@` preceded by whitespace, so `@grpc/proto-loader` or `@UseGuards(…)` ends the description there and turns the rest into a tag nobody declared — measured: `GRPC_LOADER_OPTIONS` had no description at all, and three decorators stopped at the colon introducing their own examples. Backtick it (`` `@UseGuards(…)` ``), which is correct anyway since a package name or a decorator IS code. Fenced blocks, indentation and moving the `@` mid-line do NOT help — only a non-whitespace character before it does. Prisma `///` docs are copied into the generated client, so the same rule binds there. `jsdoc-tags.spec.ts` enforces this.

**MUST NOT** — write a `/** */` where POSITION makes it attach to something other than what it describes. A docblock binds to whatever declaration follows it, and the failure is always the same shape: the text looks attached, is not, and the file reads as thoroughly documented while the symbol has nothing. Three instances, one rule:

- **Above a GROUP of enum members.** It attaches on hover to the first member alone — quietly documenting one while claiming four. Describe the group in `//`, and give any member that needs its own contract its own block.
- **Above a section banner rather than the declaration below it.** Inserting a `// ---- Section ----` header between a docblock and its method orphans the block and leaves the method undocumented; both halves still look right in the diff. Put the banner above the docblock, never between it and what it documents.

The test in all three: read what comes IMMEDIATELY after the closing `*/`. If it is not the thing the text describes, the block is misplaced.

**Keep it proportional.** A one-line constant gets one line. A function with a subtle contract gets a paragraph and an `@example`. Length is earned by the caller's need to know, not by how interesting the implementation was.

```ts
// GOOD — docblock describes; comment warns; neither narrates history.
/**
 * Parses a query-string flag into a real boolean.
 *
 * Accepts `true` / `false` (boolean or string, any case) and `'1'` / `'0'`.
 * Anything else is returned unchanged so the `@IsBoolean()` beside it produces
 * a 400 naming the property.
 *
 * @example
 * // ?includeDeleted=1   -> true
 * // ?includeDeleted=yes -> 400
 */
export const ToBoolean = () =>
  Transform(({ value }: { value: unknown }) => {
    // Not `@Type(() => Boolean)`: it resolves the string 'false' to true.
    ...
  });

/** Longest file name a presign DTO accepts. */
export const MAX_UPLOAD_FILE_NAME_LENGTH = 255;
```

```ts
// BAD — a constant carrying an essay, and the warning is nowhere near the code.
/**
 * The longest file name a presign DTO accepts.
 *
 * A bound, not a contract, and the distinction is the one
 * MAX_ATTACHMENT_FILE_NAME_LENGTH already draws. That constant matches
 * message_attachments.file_name's VarChar(255) — two places that must agree...
 * Same value today, deliberately separate: widening the attachments column
 * should not silently widen an unrelated upload route.
 */
export const MAX_UPLOAD_FILE_NAME_LENGTH = 255;
```

---

## 13. Testing

| Layer | Proves | Database | Runs in |
| :--- | :--- | :--- | :--- |
| **Unit** | One class's logic in isolation — branches, edge cases, error paths | Never real; `PrismaService` is a mock | `*.spec.ts` beside the source |
| **E2E — auth-service** | A service's Prisma queries against a **real** Postgres — tenant scoping, soft-delete filters, partial unique indexes, transactions | Real, reset between tests | `services/auth-service/test/*.e2e-spec.ts` |
| **Contract — api-gateway** | The gateway as a process, read from outside — status, envelope, headers, cookies, socket frames, published NATS messages | None (the gateway owns no database) | `test/gateway-contract/` (§13.4b) |
| **JUnit — api-gateway** | The gateway's classes; in ITs, its Spring context against a real Redis and NATS | None | `services/api-gateway/src/test/java/` |

**"E2E" means** that no mock stands between the test and what a real request actually does inside that service.

**The e2e suites run with `--runInBand`, always** — each service's shares one Postgres database. Parallel workers racing on it produce the "fails only sometimes, never under a debugger" symptom. Bake it into the npm script, not into someone's memory.

### 13.1 Naming

- **Files.** `*.spec.ts` (unit), `*.e2e-spec.ts` (either e2e flavour — the directory says which).
- **Jest configs.** `jest.config.ts` (unit) and `jest.e2e.config.ts` (e2e), per service. Same filename in both services on purpose; `displayName` (`'auth-service:e2e'`) disambiguates in output.
- **npm scripts.** Split per service — each needs different setup that can't share one `dotenv -e` invocation.
- **Bootstrap symbols.** `bootstrapE2eTest()` returning an `E2eFixture`, in each service's `test/utils/bootstrap.ts`.

```ts
describe('Auth core (e2e)', () => { … });                       // auth-service suite
describe('Auth at the HTTP boundary (e2e)', () => { … });       // gateway suite, same module

it('5. two CONCURRENT identical registrations leave exactly one row', async () => { … });
it('15. REPLAY of a spent token revokes the entire family', async () => { … });
it('a locked account cannot log in', async () => { … });        // unnumbered
```

- Top-level `describe` names the area under test and the layer — **no document reference**. Working documents are deleted once their work ships, so a `§X.Y` in a test title becomes a pointer to nothing. **Nest one `describe()` per method or route** so a `describe > describe > it` chain alone tells you what broke.
- **Number, then a period, then the sentence** — `5. …`, not `Test 5:`. The number orders cases within a suite and gives a failure a stable handle; an unnumbered case is simply one nobody needed to reference.
- **State the invariant, present tense, no "should."**
- **One word in CAPS for the condition that makes this case worth its own test** — `CONCURRENT`, `REPLAY`, `ONLY`, `NEITHER`, `BEFORE`.

### 13.2 Unit tests — mock everything but the class under test

```ts
const module: TestingModule = await Test.createTestingModule({
  providers: [
    UsersService,
    { provide: PrismaService, useValue: mockDeep<PrismaService>() },
    { provide: AuditPublisher, useValue: { emit: jest.fn() } },
  ],
}).compile();
```

- **Mock at the boundary the class actually calls** — `PrismaService`, not repository methods that don't exist in this codebase.
- **Never mock the class under test**, and never mock a pure function (`normalizeEmail`, `hashToken`, the mappers) — call the real one.
- `afterEach(() => jest.clearAllMocks())`.
- Every suite opens with a `should be defined` smoke test listing every injected collaborator.

### 13.3 E2E (auth-service) — real Postgres, reset between tests

**Point at a dedicated test database, never the dev one.** `services/auth-service/.env.test` sets `DATABASE_URL` to a separate database. A suite that can reach the developer's own data is one typo away from truncating it.

```ts
export async function bootstrapE2eTest(): Promise<E2eFixture> {
  const app = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const prisma = app.get(PrismaService);

  // Called explicitly, not via OnApplicationBootstrap: a bare TestingModule does
  // not reliably fire Nest's lifecycle hooks. It applies the partial unique
  // indexes and seeds permissions + system roles — skip it and a test asserting
  // users_org_email_key rejects a duplicate passes for the wrong reason.
  await app.get(DatabaseSeeder).seed();

  return { prisma, app };
}
```

**Two reset strategies. Pick by whether the service has seeded rows that must survive.**

*TRUNCATE an explicit table list* — for services whose tests own every row (`ingestion-service`, `ticket-service`). Drain the queues **first**, with `obliterate` rather than `drain`: `drain` leaves ACTIVE jobs running, and an active job is exactly the one about to write to the table you are emptying.

```ts
await Promise.all(queues.map((queue) => queue.obliterate({ force: true })));
await prisma.$executeRawUnsafe(`TRUNCATE TABLE "document_chunks", "ingestion_jobs", … RESTART IDENTITY CASCADE`);
```

*DELETE child-to-parent* — for `auth-service`, which **must** preserve seeded rows. Two reasons, neither stylistic:

- `RolesService` memoizes the four global system role ids for the process lifetime. Wiping and re-seeding mints new ids the memo does not know about, and the next registration fails with *"Expected 1 records to be connected, found only 0"* from inside `tx.user.create`.
- `TRUNCATE organizations CASCADE` takes `users` with it **in full** — CASCADE truncates every referencing table, not just matching rows — including the Super Admin and the system user.

```ts
await prisma.$transaction([
  // `deleted_by_id` is ON DELETE RESTRICT and points the WRONG WAY for a sweep:
  // an organization references the user who soft-deleted it, and that user
  // references the organization. No ordering satisfies both — clear them first.
  prisma.$executeRawUnsafe('UPDATE organizations SET deleted_by_id = NULL'),
  …
  prisma.$executeRawUnsafe('DELETE FROM device_sessions'),
  prisma.$executeRawUnsafe('DELETE FROM otps'),
]);
```

Rules that hold for both:

1. **Run it in `beforeEach`, not `afterEach`** — a failure's data survives for inspection instead of being erased by the next passing test.
2. **`RESTART IDENTITY`** where you truncate — irrelevant to `gen_random_uuid()` keys, but stops silent id drift the moment any table gets a sequence.
3. **Rows that are not tenant data still leak between tests.** `job_runs` carries `consecutive_failures` forward; `billing_events` survives an org delete via `ON DELETE SetNull` and re-collides on event id. Clear both explicitly.
4. **Never point a suite at the dev database.** `.env.test` sets a separate `DATABASE_URL`.

**Every domain gets a factory, not inline object literals** — one file per entity, `test/factories/<entity>.factory.ts`:

```ts
let uniqueIndex = 0; // Module-scoped: increments across the whole suite run, so two
                     // calls in one test never collide on a @unique column.

export function buildUser(overrides: Partial<CreateUserInput> = {}): CreateUserInput {
  uniqueIndex++;
  return {
    organizationId: overrides.organizationId ?? faker.string.uuid(),
    email: overrides.email ?? `user${uniqueIndex}.${faker.internet.email()}`,
    fullName: overrides.fullName ?? faker.person.fullName(),
    passwordHash: overrides.passwordHash ?? null,
    ...overrides,
  };
}
```

- **Every field has a valid default**, so a test about locking need not invent an email, a name and a tenant.
- **Every field is overridable.**
- **The uniqueness counter is mandatory** wherever the entity has a `@unique` or partial-unique column.

### 13.4b The contract harness — the gateway as a process

`test/gateway-contract/` starts the **built** gateway as a separate process,
puts real gRPC servers behind it (generated from the same `.proto` files it
loads) and asserts only what a client can see: status, envelope, headers,
cookies, socket frames, published NATS messages, the metrics port.

**Which suite a behaviour belongs in:**

| The behaviour is about | Suite |
| :--- | :--- |
| a wire fact — a header, a cookie flag, an envelope field, a frame, a metric name | `test/gateway-contract/` |
| routing, interceptors composing, Spring wiring, a mapper's shape | the gateway's JUnit tests, `services/api-gateway/src/test/java/` |
| several real services together | `test/system/` |

Two things follow from "as a process". It boots the build, so
`npm run test:contract` builds first — a source edit tested against the
previous build passes for the wrong reason. And it has no handle inside the
gateway: a peer is programmed by answering its RPC, never by
replacing a bean inside the gateway, and an assertion about an outgoing call reads the peer's
**recording** of the request and its metadata.

**A cookie is asserted as an attribute set, never as a header string.**
`parseSetCookie` in `client.ts` is what a cookie row reads: the name, the
value and the attributes a value we authored — `Max-Age`, `Path`, `HttpOnly`,
`Secure` — exactly, `SameSite`'s casing loosely, and attribute order and the
`Expires` date not at all. Those three are the serializer's to choose, so a
row that pins them pins the library rather than the contract. A clear is the semantic
form: empty value **and** (`Max-Age=0` **or** a past `Expires`) **and** the
`Path`, `HttpOnly` and `SameSite` it was set with, since a browser only
replaces a cookie whose path matches.

**A cached lookup hides its own absence from any row that does not use a cold
key.** The lifecycle gate's status read is cached in Redis for 30 seconds, so a
row reusing an organization id another suite has already touched cannot tell
whether the gateway asked at all: a gateway with no gate would pass every such
row that programs the peer's answer. A row that means to prove a lookup happens needs an id nothing else has
warmed, and an assertion that the peer was called.

**A row that sends a valid request cannot see a guard that runs late.** Every
contract row sends an otherwise-valid call, so an ordering defect — a body
validated before the session is checked, a permission refused after the body is
read — is invisible to all of them. The complement is a sweep: **send an invalid
request as the weakest caller a route allows, to every route, and require the
refusal to be the guard's** — the 401 or 403, never the body's 400. Run it with a fresh subject and a fresh tenant per call — a cached
tenant status or a spent quota decides the answer otherwise, and the sweep
measures the cache instead of the route.

**State a row writes is shared by every suite that reads it — and so is state
it spends.** Not just cache keys but the values in them, and not just values
but quota. A row that writes `FROZEN` into the shared status cache changes what
later suites see; two rows sharing a fixture id share its cached entity; and a
row acting as a user that other suites also act as spends that user's rate
limit, so a full run fails where a subset passes. **A fresh subject per row**
is the fix for all three. Where a limit is keyed by address rather than
subject, a row cannot vary it — say so in the spec's header rather than
leaving the dependence unstated.

**A row declares the API tag it exercises**, and
`declared-tags.contract-spec.ts` proves every published API has one.

**A wire behaviour belongs in a row here**, not only in the gateway's JUnit
tests: this suite reads the gateway the way a client does, from outside the
process.

### 13.5 What never gets mocked, and what always does

| Always mock | Never mock |
| :--- | :--- |
| `PrismaService`, in **unit** tests only | `PrismaService`, in either e2e suite — the point is the real database |
| The gRPC peer (`AUTH_GRPC_CLIENT`), in the **gateway's** e2e tests | The gRPC peer, in **auth-service's** e2e tests |
| `AuditPublisher`, `NotificationPublisher` — NATS side effects nothing asserts on | Pure functions: `normalizeEmail`, `hashToken`, `safeCompareHex`, every mapper |
| Wall-clock time, when a test depends on `expiresAt` (`jest.useFakeTimers()`) | The class actually under test |

### 13.6 Every mocked RPC needs an owner test

1. **The service that OWNS an RPC tests it against the real database**, even when every caller mocks it.
2. **A scheduled job with no test is the same bug with a worse failure mode.**

`tsc` will not catch this: a Prisma `where` naming a nonexistent column is normally an excess-property error, but a **conditional spread** — `...(x ? { y } : {})` — suppresses that check. See [ADR 0002](./decisions/0002-every-mocked-rpc-needs-an-owner-test.md).

### 13.7 The cross-service contract test

One suite, run in CI, that boots the **real** auth-service gRPC server (in-process, real Prisma against the test database) and a **real** `@grpc/grpc-js` client against it — no stub on either side — and drives one request through each RPC. This is what catches a proto regenerated on one side and not the other before a deploy does.

### 13.8 Source scans — what they can prove, and when they are the only option

A **source scan** is a test that reads the tree — the shape used by `limit-comparison.spec.ts`, `mapper-naming.spec.ts` and `analytics-window.spec.ts`. It proves that text **exists**, never that it **runs**. That single limit decides where it belongs.

Before writing one, ask **what the property actually is**:

| Property | Guard |
| :--- | :--- |
| **Testable per instance, quantified over ALL instances** | **Both.** The test covers a site; the scan covers the "every". |
| Has no runtime expression at all | **The scan is the only guard.** |
| Has a runtime expression; the scan stands in for a test | **Incomplete — write the test and drop the scan.** |

**The first row is the common case here, and the one where the proxy creeps in:** it is easy to pick the instance, write a scan for it, and end up with neither guard. `limit-comparison.spec.ts` is the clean example — *"this site refuses a `NaN` limit"* is testable at any one of seven call sites, while *"every site, including the one added next year"* is not testable at all. Write
both; they guard different things.

**The second row is why scans exist.** `FREE_TIER_ENTITLEMENTS` referencing `MAX_DOCUMENTS_PER_TENANT` rather than the literal `100_000` has **no runtime expression** — measured, the two are indistinguishable until the constant moves, which is the moment nobody is looking. Same for *"the mapper branch was deleted"*: both arrangements put identical bytes on the wire. No test can be written that fails today, so the scan is not scaffolding — it is the guard.

**The third row is the ceiling.** Measured: `if (false && days > maxRangeDays)` still matches a source pattern looking for that comparison. A scan cannot see that the text does not run, so a behavioural property guarded only by a scan is guarded only in appearance. `analytics-window.spec.ts` moved OUT of this row when the two windows were unified: sharing `parseAnalyticsRange` made *"both windows resolve identically"* true by construction, and what was left to guard — *"neither service has grown a local copy back"* — has no runtime expression. The replacement is better because the property changed underneath it.

**Every scan MUST carry its own vacuity guards**, because the failure mode of a scan is silence:

- **A corpus floor.** A walk over zero files reports exactly what a clean repo reports. Assert the file count, and name one file that must be in it.
- **A pattern-fires test.** Assert the detector matches the shape it was written for, and does NOT match the corrected form. Without it, test 2 passes for a regex that matches nothing.

---

### 13.9 Verify a mechanism at the mechanism, not at its neighbour

A comment describes **its own half of a boundary** and is silent about the half that produces the behaviour. That is not carelessness — it follows from the architecture — which is why reading one side carefully still gets the mechanism wrong. Four examples, all found by review rather than by tests:

| Claim, read from one side | What the other side did |
| :--- | :--- |
| a lazy initializer is memoised | it assigns **only on success**, so a failed load retries every call |
| the inbound-mail relay "reports rather than retries" a 401 | it `throw`s, and throwing is what made its host retry |
| the at-cap path skips fusion | `reciprocal_rank_fusion` is called on **both** branches |
| a page that parsed is a page that indexed | the chunker drops it again at a **second, smaller** bar |

Two rules follow, and they are cheap:

- **Read the component you are not currently thinking about.** The mechanism usually lives at the boundary between two of them.
- **Follow the failing path, not the happy one.** A lazy initializer *looks* memoised because on success it is; a boot-time check *looks* once-per-process because on success it is; an error branch is unreachable when nothing is wrong. The failing path is also where the reader ends up — nobody consults a flow document or a docblock when things are working.

**This is a different failure from the counting rule** (strip comments before counting anything over source, §13.8). That one catches a miscount; this one catches a correct count of the wrong thing.

Applies to documentation as much as to tests: `docs/reference/flows/` carries the same two rules in its own conventions list, scoped to flow documents.

---

## 14. Definition of Done (pre-PR checklist)

### 14.0 Run the machine checks first

Half this list is mechanically decidable, and a human re-reading a diff is the least reliable way to decide it. Run these before reading the boxes below — **in this order**, because each one's failure makes the next one's output meaningless:

```bash
npm run typecheck        # a type error makes every later result noise
npm run lint             # includes lint:models — the model-literal scan
npm run format:check
npm run proto:lint       # only if any .proto changed
npm run proto:breaking   #   "     "   — reviewed, not just green
npm run openapi:check    # builds the gateway with its libs, then compares docs/reference/openapi.json
npm run test             # unit
npm run test:e2e         # the suites for the services you touched
```

`openapi:check` runs the turbo build itself: the export reads the BUILT
gateway and the libraries' own `dist/`, and a stale build cannot be told from
a fresh one by mtime, so the build is part of the command rather than a step
to remember. When it reports drift, `npm run openapi:export` is the fix and
the resulting diff belongs in the PR.

Two failure modes this ordering exists to prevent:

- **Running tests over a tree that does not compile.** Jest transpiles per-file with SWC and does **not** typecheck, so a broken signature can pass every test and fail the build. `typecheck` is first for that reason alone.
- **Reporting a check you did not run.** "Tests pass" after editing only a `.py` file means `npm run test` said `--passWithNoTests`. Name the suite you ran, or run `test:py` too.

**Any box below that a command can decide, let the command decide.** The boxes are for the properties no command can see.

### Reuse

- [ ] Searched `packages/` before writing any helper; anything cross-service lives there.
- [ ] Any source scan added carries a corpus floor AND a pattern-fires test, and guards a property that has no runtime expression — or is paired with the test that does (§13.8).
- [ ] No duplicated enum, timestamp conversion, metadata key, or hashing helper.

### Security & tenancy

- [ ] Identity from the caller's verified context, never from client input.
- [ ] Every query on a tenant table filters `organizationId` (or the caller is `isSuperAdmin`).
- [ ] Every query on a soft-deletable table filters `deletedAt: null`.
- [ ] Unique-field checks handled in the service layer, soft-delete aware.
- [ ] A new "unique among active rows" rule has its **partial index in the seeder's DDL block** ([ADR 0039](./decisions/0039-the-seeder-ddl-block-is-the-list.md)) — a service-layer check alone loses the race. Asked **"does the row come back?"** before choosing partial vs full `@unique` (§7.2).
- [ ] A new limit or entitlement composes as `min()` across every layer, and an over-ceiling override is **refused, not clamped** (§4.4).
- [ ] No `enum` block added to `schema.prisma`; every write path validates the value set (§7.3).
- [ ] Correct guards, in the right order; verification endpoints not self-locked.
- [ ] Hash choice matches the lookup pattern (§8.1); comparisons use `safeCompareHex`.
- [ ] No secret in a log, response, or error message; production paths are silent.

### Contracts

- [ ] `.proto` changed → `npm run proto:generate` → both ends updated.
- [ ] `npm run proto:lint` clean; `npm run proto:breaking` reviewed (no version escape hatch — §6.1).
- [ ] `RpcException` carries a deliberate `status` from the §6.4 table.
- [ ] `undefined` → `null` normalized in the mapper; `requireProtoTimestamp` for non-optional fields.
- [ ] New NATS payload is a typed union arm in a `*.contract.ts`, and its subject is in a `*_PATTERNS` constant — **that constant is the registry**, and a subject absent from one does not exist.
- [ ] A table replicated per-service (`job_runs`, `limit_alert_generations`) was added to **every** schema that owns a copy, not just the one in front of you.

### Background jobs — see [ADR 0003](./decisions/0003-bullmq-over-nest-cron.md)

- [ ] The job is a plain method taking an explicit window — no `@Cron`.
- [ ] **Something calls it.** A repeat entry in `SchedulerModule`, with a stable `jobId`.
- [ ] BullMQ, not `@nestjs/schedule`.
- [ ] **Something records that it ran** — `JobRunRecorder.track()`; `last_succeeded_at` survives a failure.
- [ ] Ordering constraints encoded as **one job calling several in sequence**, never two cron entries minutes apart.
- [ ] An **end-to-end test drives the scheduler and reads the endpoint.**
- [ ] Anything derived from the job carries a freshness field (`dataThrough`).
- [ ] **Something ALERTS when it stops.** Adding a member to `SCHEDULED_JOBS` leaves `docker/prometheus/job-alerts.yml` a job short until it is regenerated — `npm run build -w @synapsedesk/contracts -w @synapsedesk/core && node scripts/generate-job-alerts.mjs`. The build comes first because the generator reads the BUILT lib, and a stale one silently emits the old job list.

### Surface

- [ ] New env var added to the Joi schema **and** `env.example`.
- [ ] New permission code added to `PERMISSION_CODES` + `PERMISSION_NAMES` + role grants + [api-endpoints-plan.md §9](./api-endpoints-plan.md).
- [ ] A gateway route or its request or response model changed → `npm run openapi:export`, and the diff on `docs/reference/openapi.json` is in the PR. CI's `build` job runs `openapi:check` and fails on drift.
- [ ] Endpoint documented in [api-endpoints-plan.md](./api-endpoints-plan.md); schema change reflected in [rdm-spec.md](./rdm-spec.md) — **columns, types, nullability, defaults and the enum's full value list.** A widened enum whose doc still lists the old members is the most common drift and the least visible.
- [ ] New cross-service behaviour — an ordering constraint, a dial-out direction, a consistency sweep — recorded in [reference/sys-flows.md](./reference/sys-flows.md). Anything visible inside one service does **not** go there.
- [ ] `npm run lint` clean.

### Docs & comments

- [ ] Every exported symbol has a docblock whose first line says what it is (§12.3).
- [ ] No design rationale, history, or migration note inside a docblock — it went to an ADR or the PR.
- [ ] Traps sit as `//` comments on the line they apply to.

### Testing

- [ ] Unit tests mock `PrismaService` and every collaborator; nothing touches a real database.
- [ ] A new Prisma query with tenant or soft-delete filtering has an **e2e** test against a real test database (§13.3).
- [ ] Test database reset runs in `beforeEach` and uses the right strategy for the service (§13.3, Golden Rule 10).
- [ ] New factory functions carry the uniqueness counter for every `@unique`/partial-unique field.
- [ ] New gateway endpoint has a contract row in `test/gateway-contract/` asserting the **envelope**, not just the HTTP status (§13.4b).
- [ ] `describe`/`it` titles follow §13.1.
- [ ] `jest.clearAllMocks()` in `afterEach`.
- [ ] Any RPC this PR adds is executed by a test in the service that **owns** it (§13.6).

---

## 15. Related Documents

See [README.md](./README.md) for the full map: core specs, `decisions/`, `reference/`, and the numbered implementation plans.

When a rule here conflicts with the code, one of them is wrong — say which in the PR rather than silently following the other.
