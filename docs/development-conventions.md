# Development Conventions

**Audience:** every developer writing code in this repository.
**Scope:** rules and examples only. Current state lives in [`reference/`](./reference/), reasoning lives in [`decisions/`](./decisions/). See [README.md](./README.md).

Read §1 and §2 before your first commit. Use §14 as a pre-PR checklist.

Wording is deliberate:

- **MUST / MUST NOT** — a reviewer should block the PR.
- **SHOULD** — deviate only with a comment saying why.
- **MAY** — genuine discretion.

Every rule here exists because getting it wrong produces a failure that is *silent*. Loud failures don't need conventions; the compiler catches those.

---

## 1. The Golden Rules

1. **Search `libs/` before you write a helper.** If two services need it, it belongs in `libs/common` or `libs/grpc-proto` — not copied. (§3)
2. **Never trust the client for identity or tenancy.** `user_id`, `organization_id`, `department_ids` and `permission_codes` come from the JWT via `@CurrentUser()`, never from a path, body or query. (§4)
3. **Never trust the client for provenance either.** `ip` / `userAgent` are *observed* by the gateway (`RequestOrigin`), never claimed by the caller. (§4.3)
4. **Every Prisma query on a soft-deletable table filters `deletedAt: null`.** Prisma cannot do this for you. (§7.1)
5. **Every unique constraint on a soft-deletable table is enforced in code, not in the schema.** (§7.2)
6. **Never declare an `enum` in `schema.prisma`.** Enumerated columns are `String`; the values live in `@synapsedesk/common`. (§7.3, [ADR 0001](./decisions/0001-no-prisma-enums.md))
7. **Controllers return raw data.** `TransformInterceptor` owns the envelope. (§5.1)
8. **Every gRPC call goes through `BaseGrpcClient.call()`** — that is what supplies the deadline and packs the metadata. (§6.3)
9. **Choose the hash by how the value is looked up**, not by habit. (§8.1)
10. **Production must be silent.** No internals, no stack traces, no "requires permission X" hints past the gateway boundary. (§8.4)
11. **gRPC for reads, NATS for side effects.** A mail outage must never fail a registration. (§6, §9)
12. **Reset test state in `beforeEach`, and match the strategy to whether the service has seeded rows to preserve.** (§13.3)

---

## 2. Architecture & Layering

**Ownership holds even before a service exists.** A table belongs to the service that owns its domain, whether or not that service is built yet — `audit_logs` belongs to `ticket-service`, so Domain A *publishes* audit events rather than growing its own table. Writing a table into the wrong service is a migration problem later, not a shortcut now.

### 2.1 Layering inside a service

```txt
gateway:   Controller ──> *-grpc.client.ts ──> (wire)
              │                  │
           DTOs +            extends BaseGrpcClient
           guards            mapper: proto -> DTO

service:   *-grpc.controller.ts ──> *.service.ts ──> PrismaService
                                        │
                                    mapper: Prisma row -> proto
```

- A gateway **controller MUST NOT** contain business logic, build a gRPC `Metadata` object, or touch Prisma (it has no database).
- A gateway **`*-grpc.client.ts` MUST return proto types only** — it never imports a DTO or a mapper. Conversion is the **mapper's** job and the **service's** to invoke (§6.3).
- A service **`*-grpc.controller.ts` MUST be a thin adapter**: unpack metadata, delegate, return the proto message. No queries, no branching.
- A service **`*.service.ts` MUST NOT know about HTTP.** It throws `RpcException` with a gRPC `status`, never `BadRequestException`. (§6.4)
- **`libs/` MUST NOT import from `apps/`.** Ever.
- `libs/common` **MUST NOT** import `@grpc/grpc-js` types into domain declarations — `libs/grpc-proto` is where the wire lives.
- **A provider that holds a connection MUST be an `@Injectable` class implementing `OnModuleDestroy`, registered with `useClass`.** Nest calls lifecycle hooks only on providers it instantiated from a class; a value returned by `useFactory` is just a value, so implementing the interface on it does nothing and no warning is issued. The connection is then never closed on `app.close()` — one leak per restart in production, and a test run that passes and then hangs with no output. `common/redis/redis.service.ts` is the reference.

### 2.2 Where a new file goes

| You are adding… | Put it in |
| :---- | :---- |
| A type or constant two services need | `libs/common/src/configs/*.config.ts` |
| A NATS message shape | `libs/common/src/contracts/*.contract.ts` |
| A proto enum ↔ domain enum bridge | `libs/grpc-proto/src/mappers/` |
| A gRPC DI token / path / channel option | `libs/grpc-proto/src/constants.ts` |
| A pure function used by one service only | `apps/<svc>/src/common/utils/utils.ts` |
| A gateway guard / interceptor / decorator | `apps/api-gateway/src/common/<kind>/` |
| A REST request/response shape | `apps/api-gateway/src/modules/<mod>/dto/rest/` |
| A GraphQL request/response shape | `apps/api-gateway/src/modules/<mod>/dto/graphql/` — **independent of the REST DTO** (§12.2) |

---

## 3. Shared Libraries — Use Them

These libraries exist so services agree with each other on the wire and on shared domain values. Entry points: `libs/common/src/main.ts`, `libs/grpc-proto/src/index.ts`.

Import by package name, **never by relative path across app boundaries**:

```ts
import { RequestContext, PermissionCode } from '@synapsedesk/common';
import { toTimestamp, GRPC_DEADLINE_MS } from '@synapsedesk/grpc-proto';
```

**MUST NOT:** hand-roll a `new Date(seconds * 1000)`, write a `{ seconds, nanos }` literal, cast a proto enum to a domain enum, or build a bare `new Metadata()` outside `libs/grpc-proto`.

**MUST:** call `normalizeEmail()` at every email entry point. One path that skips it makes `JOHN@acme.com` a second account.

### 3.1 Adding to a shared library

1. Confirm a **second** consumer exists or is imminent. One consumer ⇒ keep it local.
2. Add it to the owning module and export from the entry point (`main.ts` / `index.ts`).
3. Document *why it is shared* in the docblock, not what it does.

### 3.2 `as const` or an explicit element type — decided by which one is the source

A constant array is one of two things, and the shape follows from which:

| The array is | Shape | Because |
| :---- | :---- | :---- |
| The **source** of a union type | `as const` | `(typeof X)[number]` only narrows if the literals are preserved — `PERMISSION_CODES`, `OCR_LANGUAGES` |
| A **subset** of a union that already exists | `readonly T[]` | The union is the source; annotating with it is what makes a wrong member a compile error — `NON_LATIN_OCR_LANGUAGES: readonly OcrLanguage[]` |
| Both — a subset whose members must also stay literal | `as const satisfies readonly T[]` | `ALLOWED_DOCUMENT_MIME_TYPES` |

Same rule for a scalar: `const CHEAP_MODEL: AiModel = '…'` when the union exists, so a typo is caught where it is written rather than where it is used.

**A field typed `string` where a union exists is a bug, not a style choice** — it is the shape that lets a value be filtered out or silently defaulted downstream. Narrow at the boundary by *parsing*, never by casting at the point of use: a cast moves the failure, a parse removes it (`parseOcrLanguages`).

---

## 4. Multi-Tenancy, Identity & Request Scoping

### 4.1 Reading the caller

```ts
@Get()
@UseGuards(JwtAuthGuard)
findAll(@CurrentUser() ctx: RequestContext) { … }

// or one field
findOne(@CurrentUser('organizationId') orgId: string | null) { … }
```

- `@CurrentUser()` requires an authenticating guard. Without one it throws a 500 that *names the missing guard*.
- A caller mid-2FA-challenge has **no** permissions and **no** organization. Use `@Current2faUser` + `Jwt2faGuard` there. Never `@CurrentUser`.
- `req.user` is typed `MaybeJwtPayload`. **MUST** narrow with `isFullJwtPayload()`; **MUST NOT** cast to `JwtPayload` — that cast reads a half-authenticated request as a complete one with silently empty permissions.

### 4.2 Tenant isolation

- `organizationId === null` means **platform Super Admin** (`is_super_admin = true`), kept in lockstep by a DB CHECK constraint. It does *not* mean "no tenant".
- Every query touching a tenant-scoped table **MUST** filter by the caller's `organizationId`, except when `isSuperAdmin`.
- Cross-tenant reads via a resource id **MUST** go through `RequestContextService.validateOrganizationScoping()`.
- The gateway **MUST NOT** accept `organizationId` as client input. Sole exception: `/platform/*`, where the tenant is an explicit path segment and `SUPER` is required.
- Scoping is **entirely manual** — there is no Prisma middleware ([known-gaps](./reference/known-gaps.md) #1). Treat a missing `organizationId` filter as a security bug in review.

### 4.3 Provenance

`RequestOrigin` (`{ ip, userAgent }`) is what the gateway *observed*. It is written to `device_sessions`, `password_reset_tokens` and `audit_logs`.

- **Read it with `@CurrentOrigin()`** — it needs no guard, which is the point: provenance exists for anonymous callers. An authenticated handler taking `@CurrentUser()` needs neither; `RequestContext` extends `RequestOrigin`. **Never** add `@Req() request: Request` just to reach `req.ip`.
- Pass it into every gRPC call — `BaseGrpcClient.call(invoke, origin)` requires it.
- For a background job with no real request, use the frozen shared `UNKNOWN_ORIGIN`, not an inline `{ ip: '', userAgent: '' }`.
- `app.set('trust proxy', N)` — **N is a hop count.** Behind both an ALB and Nginx it must be `2`, or every provenance column records Nginx's address.

### 4.4 Entitlements and limits — every layer narrows, no layer widens

Four things can bound one operation: a **platform ceiling** (a code constant), the **plan grant** ([RDM Table 40](./rdm-specs.md)), the grant **denormalized onto the tenant**, and the tenant's own **override**. The effective limit is the `min()` of all of them.

- **Read the `min()`, never one layer.** A reader that trusts the plan column alone ignores a tenant that narrowed itself; one that trusts the override alone ignores the plan. Compose at the read site.
- **A plan may only narrow.** The platform ceiling protects a parser or a transport, and is not sellable — so a plan column is an argument to `min()`, never a replacement for it. Selling more than the platform admits must stay unexpressible.
- **An override above the ceiling is REFUSED, not clamped.** Clamping accepts a request that asked for a self-service entitlement grant and silently gives less; the edge must 400.
- **A plan grant is `NOT NULL`; a tenant override is nullable.** A subscription always grants a value, so a blank grant is a bug. `NULL` on an override means "the tenant configured nothing", which is the normal state — the two nullabilities carry different meanings and must not be unified.
- **Denormalize the grant onto the tenant row.** Enforcement paths read one row; joining the catalogue on every presign puts it in the hot path of the highest-volume route in the system.
- **The direction of dial-out is fixed: `ingestion-service` calls `auth-service`, never the reverse.** Auth owns the limits, ingestion owns storage and document counts, and neither can produce a whole verdict — the **gateway** composes the legs and reports **which dimensions each run actually covered**. An unevaluated dimension and an evaluated-and-clear one are different answers; collapsing them lets a downgrade through on a timeout.
- **Adding a dimension is five edits, not one:** the plan column, the denormalized tenant column, the `min()` at every read, the composer's coverage list, and [rdm-specs.md](./rdm-specs.md). A dimension added to only the first two enforces nothing.

---

## 5. REST API Conventions (gateway)

### 5.1 The response envelope

```json
// success — built by TransformInterceptor
{ "success": true, "statusCode": 200, "message": "OK", "warning": null, "data": {} }

// failure — built by AllHttpExceptionFilter
{ "success": false, "statusCode": 404, "path": "/api/v1/users/x", "timestamp": "…", "error": "User not found!" }
```

`success` is the single discriminant a client branches on. Therefore:

- Handlers **MUST** return raw data. Returning `{ data, message }` yields a double-wrapped response.
- Static message → `@ResponseMessage('User created')`.
- Runtime message/warning → `@Res({ passthrough: true })` then `res.locals.message = …`. Dynamic wins over static.
- A `void` handler still emits `data: null` — never `undefined`, which `JSON.stringify` drops.
- **GraphQL bypasses the envelope.** Any new global interceptor **MUST** branch on `getType<GqlContextType>() === 'graphql'`, as the existing interceptor and filter already do.

### 5.2 DTOs

- One class per direction: `dto/rest/create-user.dto.ts`, `dto/rest/user-response.dto.ts`. **No shared base class, no `dto/base/`** (§12.2).
- The global `ValidationPipe` runs `whitelist: true, forbidNonWhitelisted: true, transform: true`. An undeclared body field is a **400**, so a DTO missing a field silently rejects valid traffic.
- Primitives from query/param need `@Type(() => Number)` — everything arrives as a string.
- **`@IsNullable()` ≠ `@IsOptional()`.** `@IsNullable()` permits an explicit `null` while still requiring the key; `@IsOptional()` permits the key to be absent. Response DTOs use the former (§6.5).
- List endpoints **MUST** extend `SearchPaginationDto` (`common/dto/rest/search-pagination.dto.ts`, defaults from `DEFAULT_SEARCH`) and return `PaginationResponseDto<T>`.

#### `?` on a request field, and when to replace it with a default

A `?` costs every layer below a branch on `undefined`. Prefer a real default plus an explicit **`@ApiPropertyOptional()`** — the Swagger plugin derives `required` from **TypeScript** optionality, not from `@IsOptional()`, so dropping the `?` without the decorator documents the field as required and a generated client refuses to send the request without it.

**Three cases where the `?` is load-bearing and MUST stay:**

- **The proto field has explicit presence.** `optional int32 max_agent_seats` distinguishes absent from `0`; a plain `int32` cannot. A default on a DTO feeding an `optional` field either invents a value the owning service meant to choose (`CreatePlatformOrganization` — the proto says "absent takes the schema default rather than zero") or, on a PATCH, **resets the column on every unrelated update**. Read the `.proto` before removing the `?`.
- **The route SETS a collection.** `SetUserRolesDto.roleIds` is required on purpose: defaulted to `[]`, an omitted body reads as "strip every role" instead of "change nothing".
- **The absent value is not expressible.** If no value in the type means "the caller said nothing", `undefined` is the only honest answer.

Where absent and empty are indistinguishable on the wire — every `repeated` field, and any implicit-presence scalar — the `?` buys nothing and the default is strictly better.

**A default is only a DEFAULT once the downstream branch is deleted.** Adding
`= []` to the DTO while `dto.field ?? []` survives in the mapper gets the
ceremony and none of the benefit: the value is supplied twice, and nothing says
which one is doing the work. Removing the `?` is half the change — the other
half is deleting every `??` the `?` was paying for, which is the cost the rule
above is written to recover.

**No runtime test can see the difference**, because both arrangements put the
same bytes on the wire. Measured: with the DTO default removed AND the mapper
branch restored, every assertion about the outgoing message still passes. The
guard is therefore a scan — `default-branch-pairing.spec.ts` fails when a mapper
branches on a field its DTO already defaults. A field whose DTO carries NO
default is none of that check's business: `clearStripeProductId` resolves its
absent case at the mapper precisely because a default at the DTO would clear the
column on every unrelated PATCH.

**A constant spread into a `create` MUST be typed to the shape it is spread
INTO, not the shape it came from.** Object literals get excess-property checks;
**spreads do not**. So `{ ...SOME_CONSTANT }` passed to a Prisma `create` is
unchecked for extra fields, it compiles, and the failure surfaces at the
database rather than at the compiler. Measured: spreading a nine-field
entitlement constant — one field of which is a PLAN's label with no column on
`organizations` — into an organization create broke 359 tests at runtime with a
clean build. Derive the narrower shape (`Omit<…>`) and `satisfies` it, so a
field added to the wider type still has to be answered on both paths.

**A default is VALIDATED, so it must satisfy the field's own bounds.** `@IsOptional()` skips only `undefined` and `null`; a defaulted field always holds a value, so the validators run on it. `limit: number = 0` beside `@Min(1)` rejects every request that omits the field — a 400 on the default path, which no test that always sends the field will catch.

### 5.3 Guard matrix

Order matters — Nest runs guards left to right.

| Guard | Purpose | Put it on | **Never** put it on |
| :---- | :---- | :---- | :---- |
| `JwtAuthGuard` | Requires a valid access token | everything authenticated | `/auth/login`, `/auth/register`, `/auth/refresh` |
| `Jwt2faGuard` | Authorizes the 2FA challenge leg only | `/auth/login/2fa` | anything else |
| `GuestGuard` | Rejects callers who already hold a live session | `/auth/login`, `/auth/register` | any authenticated route — it would reject 100% of traffic |
| `EmailVerifiedGuard` | Requires a proven email | routes that **send mail on the tenant's behalf** — invitations today | `/auth/*`, and **especially** `/auth/email/verify*` — that deadlocks the account permanently. Also anything a new user needs before they are verified, e.g. `GET /knowledge/articles*` |
| `PermissionGuard` | RBAC via `@RequirePermission` | after `JwtAuthGuard` | before it |

- **Unverified is not unauthenticated.** An unverified user has a real session and a real identity; they are *limited*. That limit belongs on the routes below, not on the verification endpoints.
- **`EmailVerifiedGuard` guards OUTBOUND MAIL, not spend.** This row used to read *"anything spending quota or sending mail"*, and five controllers disagreed with it in silence — tickets, documents, chat, and both `/knowledge` AI routes all spend and none carries the guard. The narrow rule is the one the code already argues: `departments.controller.ts` says it is ungated because *"unlike invitations, nothing here sends mail on the tenant's behalf"*, and `otp.controller.ts` says the guard would deadlock the account. Spend is bounded by the AI cap per tenant and by `ROUTE_THROTTLE` per user; verification adds nothing those two do not already enforce, and it would lock a brand-new user out of the self-service path before they ever open a ticket.
- **The help centre is explicitly ungated.** `GET /knowledge/articles*` spends nothing and is what someone reads *instead of* raising a ticket. Gating deflection behind a verification mail is the wrong end of the funnel.
- `GuestGuard` checks **only the access token**, on purpose. It is a UX guard, not a security control — failing open is correct.

### 5.4 Permissions

- `@RequirePermission(...)` is **ANY**, not ALL. For a route needing two distinct grants, stack the guard twice.
- The tuple type makes `@RequirePermission()` a compile error — empty metadata would read as "no permission required".
- `isSuperAdmin` bypasses `PermissionGuard` entirely.
- **`PERMISSION_CODES` in `libs/common` is the single source of truth**: it derives the `PermissionCode` union *and* seeds the `permissions` table. Adding one means editing that array, `PERMISSION_NAMES`, the relevant `SYSTEM_ROLE_PERMISSIONS`, and [api-endpoints-plan.md §9](./api-endpoints-plan.md).

### 5.5 Cookies

- Tokens ride in cookies named by env var (`JWT_ACCESS_NAME`, `JWT_REFRESH_NAME`, `JWT_2FA_NAME`, `TENANT_SELECTION_NAME`, `DEVICE_TOKEN_NAME`). **Never hardcode a cookie name**, and never read one outside `JwtCookieService`. All are HTTP-only with `SameSite` from `COOKIE_SAMESITE`.
- **Response bodies carry no tokens.** `settleLogin()` in `auth.controller.ts` is the reference — it sets cookies and returns `{ user }` or a challenge flag.
- Login is a **three-way** outcome (tokens · `requiresTenantSelection` · `requiresTwoFactor`), and **tenant selection is resolved before 2FA** — `enforce_two_factor` is per-tenant and unanswerable until the tenant is known. Any new entry point that issues a session routes through the same helper.
- The gateway **verifies, never mints**: it holds only *public* JWT keys. Do not add a private key to the gateway.

---

## 6. gRPC Conventions

### 6.1 Contract first

`.proto` files live in `libs/grpc-proto/src/proto/<package-path>/`. Change the proto → `npm run proto:generate` → fix both ends. **Never hand-edit `src/generated/`.**

- The directory path **MUST** equal the package name with dots as slashes: `package synapsedesk.auth` ⇒ `proto/synapsedesk/auth/`. `buf lint` enforces this. Protobuf's type namespace is flat and global, so a bare `package auth` claims that name process-wide.
- Tooling is `buf` (an npm devDependency), **not** a system `protoc`.

| Command | Does |
| :---- | :---- |
| `npm run proto:generate` | Regenerates `src/generated/` per `buf.gen.yaml` |
| `npm run proto:lint` | Enforces the layout + naming rules in `buf.yaml` |
| `npm run proto:breaking` | Diffs the wire contract against `main` |

The package is deliberately **unversioned** (no `.v1`), so there is no v2-beside-v1 escape hatch. `proto:breaking` is the only thing between an edit and a wire-incompatible deploy — keep it in CI.

### 6.2 Bootstrap

Server (`main.ts`) and client (`ClientsModule.register`) **MUST** both pass `GRPC_LOADER_OPTIONS` and spread `GRPC_CHANNEL_OPTIONS`, using `AUTH_PACKAGE_NAME` / `AUTH_PROTO_PATHS` from the lib.

### 6.3 Client adapters

Every gateway client **MUST** `extends BaseGrpcClient`, declare `serviceName`, resolve the stub in `onModuleInit()`, and route calls through `this.call(invoke, origin)`. That method supplies the deadline, translates `TimeoutError` → `GatewayTimeoutException` (504, naming the peer), and packs the metadata.

**MUST NOT** copy a bespoke `firstValueFrom(...)` into a client. Reuse an existing peer connection rather than opening a second one to the same service (`OtpModule` imports `AuthModule` for `AUTH_GRPC_CLIENT`).

#### Each layer owns one type vocabulary

A client speaks **proto**. A mapper turns proto into **DTO**. A service composes and returns **DTO**. The restriction is what makes each layer readable on its own, and it is enforced by imports rather than by discipline: a client that cannot import a DTO cannot drift into shaping a response.

| Layer | Returns | May import |
| :---- | :---- | :---- |
| `*-grpc.client.ts` | the generated proto message | `@synapsedesk/grpc-proto` — **never** `dto/`, **never** a mapper |
| `*.mapper.ts` | a REST/GraphQL DTO | proto types, DTOs, `libs/` bridges |
| `*.service.ts` | a DTO | the client and the mapper |
| `*.controller.ts` | whatever the service returned | the service — **never** a client, **never** a mapper |

**MUST** — a client method's signature names proto types on both sides. Its parameter is the request message and its return type is the response message; unwrapping one field (`response.backupCodes`) or accepting a request DTO is still coupling transport to REST.

**MUST** — every `*-grpc.client.ts` has a `*.service.ts` beside it, and the service is the only thing that calls it. A client with no service is a client whose consumer has to do the mapping.

**MUST NOT** — call a mapper from a controller. A controller routes: it binds the request, delegates once, and returns. A `toXDto(await this.client.x())` in a handler is the mapping layer leaking upward, and it is how two routes over the same RPC end up shaping the response differently.

**A pass-through service is acceptable and expected.** Most modules have nothing to compose, so their service reads as one-line delegations — that is the layer doing its job, not an empty one. It is also where the first piece of orchestration lands, and having it already there is what stops that logic appearing in a controller instead.

**A DataLoader answers the edge type, not the wire message.** A loader is the batching equivalent of a service, so `loaders.users.load(id)` returns the `…GqlDto` the schema declares and the mapping happens inside `createXLoader`. A loader that returns proto pushes the mapping into every `@ResolveField` that reads it — six of them for `UserSummary` alone — which is the same leak this section forbids, arriving through the one door the table does not name.

**Binding a request is not mapping a response.** A resolver may call `toPageQuery(args)`, which is why that function lives in `common/graphql/` and not in `common/mappers/`: turning arguments into a query is what a REST controller does with a query DTO. The prohibition is on shaping what comes *back*.

**A value that is not a response shape is not a DTO.** Tokens the controller needs for cookies (`accessToken`, `deviceToken`) belong in a service-layer result type named for what it is — `TwoFactorAuthenticateResult`, not `...Dto` — so a secret cannot reach a REST body by inheriting the wrong name.

### 6.4 Errors across the boundary

Services throw `RpcException({ code: status.X, message })`. The gateway maps:

| gRPC status | HTTP | Use for |
| :---- | :---- | :---- |
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

Mappers live in `libs/grpc-proto/src/mappers/`, named per §12.1.

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
  /// InvitationStatus in @synapsedesk/common. Deliberately a String, not a
  /// Prisma enum — see development-conventions §7.3.
  status String @default("PENDING") @db.VarChar(50)
}
```

```ts
// libs/common/src/configs/app.config.ts — the single source of truth
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
| :---- | :---- | :---- | :---- |
| `users.password_hash` | **Argon2 / bcrypt** | VarChar(255) | Low-entropy human secret; slowness is the defence |
| `device_sessions.refresh_token_hash` | **SHA-256 hex** | VarChar(64) | `@unique`, looked up **by value** |
| `device_sessions.device_token_hash` | **SHA-256 hex** | VarChar(64) | same |
| `password_reset_tokens.token_hash` | **SHA-256 hex** | VarChar(64) | same |
| `otps.code_hash` | see note | VarChar(255) | Found via `(user_id, purpose)` index, **not** by value |
| `two_factor_backup_codes.code_hash` | see note | VarChar(255) | Found via `user_id`, not by value |

**The rule:** a randomly-salted hash (bcrypt/Argon2) produces a different digest every time, so it can never be found by an indexed equality lookup. Any secret stored in a `@unique` column that arrives from the client and must be *found* therefore uses `hashToken()` (SHA-256) — those tokens are 256 random bits, and slow KDFs exist to protect *guessable* secrets.

The converse holds: `otps.code_hash` and `two_factor_backup_codes.code_hash` are not looked up by value, so they are free to use a slow KDF — and a 6-digit code is exactly the low-entropy case that warrants one. Both are `VarChar(255)` to accommodate that; today both use `hashToken()` ([known-gaps](./reference/known-gaps.md) #2).

Compare digests with `safeCompareHex()`, **not `===`**.

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

Subjects and payloads live in `libs/common/src/contracts/*.contract.ts` as **discriminated unions**. NATS is untyped on the wire: a publisher that renames a field fails *silently* — the message is delivered, the consumer reads `undefined`, and the email goes out saying "Hello undefined". Both ends importing the same declaration turns that into a compile error.

- Fire-and-forget for side effects, never request/response: `emit()` on the core transport, `JetStreamPublisher.publish()` on the durable subjects.
- **MUST NOT** `await` a notification publish in a request path.
- A new template means a new arm of `SendEmailCommand` with its own required `data` fields — **not** a `Record<string, unknown>` bag.
- Publishing services hold **no** SMTP/Twilio credentials. Those belong to `notification-service` alone.

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
- Magic numbers and literal unions go in a topic-named `common/config(s)/<topic>.config.ts`, not inline. Cross-service values go in `libs/common/src/configs/<topic>.config.ts`.
- `.env` is git-ignored. **Every service MUST ship an `env.example`** (plus `serviceAccountKey.json.example` where applicable).
- The only pre-`ConfigModule` `process.env` reads are in `main.ts`, where transport options are computed before DI exists.

---

## 11. Error Handling & Logging

- `formatErrorMsg(err)` normalizes anything throwable to one trailing `!`. Use it rather than `err.message`, which is `undefined` for non-`Error` throws.
- One `Logger` per class: `private readonly logger = new Logger(Foo.name)`.
- Levels: `debug` = dev aid; `warn` = suspicious but handled; `error` = a bug or failed dependency, with the stack.
- Security-relevant events **MUST** be logged at `warn` or above *and* written to `audit_logs`.
- **MUST NOT** swallow an error to satisfy a type. If it is genuinely ignorable, comment why (`GuestGuard`'s `catch` is the reference).

---

## 12. Naming & Layout

| Thing | Convention | Example |
| :---- | :---- | :---- |
| File | `kebab-case.<role>.ts` | `jwt-auth.guard.ts`, `user.mapper.ts` |
| Gateway gRPC adapter | `<peer>-grpc.client.ts` | `otp-grpc.client.ts` |
| Service gRPC entry | `<domain>-grpc.controller.ts` | `users-grpc.controller.ts` |
| Scheduled job | `<subject>-<verb>.job.ts` | `invitations-expiry.job.ts` |
| Seeder | `<scope>.seeder.ts` | `database.seeder.ts` |
| Wire ↔ domain mapper | `<entity>.mapper.ts` | `user.mapper.ts` |
| **Mapper, outbound** | **`to<ReturnTypeName>`** — destination type's name verbatim, suffix included | `toTicketResponseDto`, `toProtoTimestamp` |
| **Mapper, inbound** | **`from<InputTypeName>`** — the *source* type's name, verbatim | `fromProtoGender`, `fromProtoOrgStatus` |
| Mapper, inbound + required | `require<InputTypeName>` — throws where `from*` would return `undefined` | `requireProtoTimestamp` |
| REST DTO | `dto/rest/<name>.dto.ts` → `<Name>Dto` | `ticket-response.dto.ts` → `TicketResponseDto` |
| GraphQL DTO | `dto/graphql/<name>.gql-dto.ts` → `<Name>GqlDto` | `ticket-response.gql-dto.ts` → `TicketResponseGqlDto` |
| GraphQL schema type | Class name **minus** `ResponseGqlDto`, set explicitly in `@ObjectType('…')` | `TicketResponseGqlDto` → `Ticket` |
| Resolver | `<module>.resolver.ts`, at the module root beside the controller | `tickets.resolver.ts` |
| DataLoader | `common/graphql/loaders/<entity>.loader.ts` | `user-summary.loader.ts` |
| NATS payload types | `*.contract.ts` | `notification.contract.ts` |
| `.proto` file | `lower_snake_case.proto` — **underscores, not hyphens** | `two_factor.proto` |
| proto package | `synapsedesk.<service>`, no version suffix (§6.1) | `synapsedesk.auth` |
| proto directory | Mirrors the package, dots → slashes | `proto/synapsedesk/auth/` |
| proto enum member | `<ENUM_NAME>_<VALUE>` — **required** | `GENDER_MALE`, `OTP_PURPOSE_UNSPECIFIED` |
| Class | `PascalCase` + role suffix | `PermissionGuard` |
| DI token | `SCREAMING_SNAKE` `Symbol` | `AUTH_GRPC_CLIENT` |
| Metadata key const | `SCREAMING_SNAKE_KEY` | `PERMISSION_KEY` |
| Permission code | `target.action` | `ticket.assign.self` |
| DB table / column | `snake_case` via `@map` | `refresh_token_hash` |
| Prisma field | `camelCase` | `refreshTokenHash` |
| Enumerated column | `String @db.VarChar(50)` — **never** a Prisma `enum` (§7.3) | `status String @default("PENDING")` |
| Enum value | `SCREAMING_SNAKE`, stored verbatim | `SUSPENDED_PAST_DUE` |
| NATS subject | `dot.separated.lowercase` | `notification.email.send` |
| Audit action | `SCREAMING_SNAKE` past tense | `PASSWORD_RESET_COMPLETED` |

**Proto enum members are prefixed because protobuf uses C++ scoping** — enum values are *siblings* of their type, so they must be unique across the whole **package**. Two enums both declaring a bare `UNSPECIFIED` is a hard compile error. `buf lint`'s `STANDARD` ruleset catches it before protoc does.

### 12.1 Two protocols, one module

```txt
modules/<module>/
├── <module>.controller.ts        REST
├── <module>.resolver.ts          GraphQL — same level, not under a graphql/ subtree
├── <entity>.mapper.ts            BOTH protocols' mappers, one file
├── <x>-grpc.client.ts
└── dto/
    ├── rest/     <name>.dto.ts
    └── graphql/  <name>.gql-dto.ts
```

- **In `dto/graphql/`, the DECORATOR decides the name.** An `@ObjectType` is an output shape: it ends `ResponseGqlDto` and lives in `<entity>-response.gql-dto.ts`. An `@InputType` or `@ArgsType` is an input: it never carries `Response` and never lives in a `-response` file. The decorator is the only reliable signal — a class named `…Page` or `…Payload` is still an output, and GraphQL will not let one class be both.
- **Requests and responses live in different files.** `<entity>.dto.ts` holds what a route ACCEPTS; `<entity>-response.dto.ts` holds what it RETURNS, and every class in it ends `ResponseDto`. The split is what makes "does this class get validated?" answerable from the import line: a `ValidationPipe` runs on request DTOs and never on response ones, so the two need opposite things from their decorators (§5.2), and a response class sitting in the request file invites both mistakes — validators nobody runs, and a request field nobody validates. `dto-naming.spec.ts` enforces BOTH halves — the suffix, and the file a response class is filed in.
- **The suffix carries the protocol, not just the folder.** Two files with one name in two folders are ambiguous in an import line and in editor search.
- **Both protocols' mappers live in one `<entity>.mapper.ts`** — putting the wire→REST and wire→GraphQL conversions side by side is what makes a divergence between them visible.
- **`to<ReturnTypeName>` / `from<InputTypeName>` always name the FOREIGN side.** `toUser` is the version this rule exists to prevent. Full reasoning: [ADR 0004](./decisions/0004-mappers-name-the-foreign-side.md).
- **A GENERIC wrapper return type does not resolve, and `to<Entity>PageDto` is the convention that grew in its place.** `PaginationResponseDto<DocumentResponseDto>` has no single name to carry verbatim, so the rule above has no answer for it — and thirteen files independently reached the same one. Written down because a scan applying the rule literally reports every one of them, and a guard that reports thirteen false positives is a guard somebody switches off. `mapper-naming.spec.ts` exempts a return type containing `<` for exactly this reason.
- **An ARRAY return pluralizes the type's name, not the suffix**: `SimilarTicketResponseDto[]` is `toSimilarTicketResponseDtos`, never `toSimilarTicketDtos`. Dropping `Response` is the common way this rule fails, because the shorter name reads perfectly well and stops identifying what it returns.
- **`mapper-naming.spec.ts` enforces all of this**, scanning `*.mapper.ts` from the CODE toward the rule. Six violations reached `main` before it existed and every one was found by somebody happening to open the file — a reviewer sees the mapper in their diff and nothing reads the rest.

### 12.2 REST and GraphQL DTOs share nothing

**No inheritance, no shared parent, no `base/` folder.**

`@Field()` is not inherited from an undecorated property. A field added to a REST parent is inherited, typed, and **absent from the GraphQL schema**, with the compiler silent and every test passing.

Two independent classes, paired by a contract spec (`<name>.contract.spec.ts`) that compares field names and checks `@Field({ nullable })` against the REST DTO's `| null`. A divergence becomes a test failure naming the field, instead of a schema that quietly lacks it.

**One import to get right:** `PickType` / `OmitType` / `PartialType` exist in **both** `@nestjs/swagger` and `@nestjs/graphql`. Building a GraphQL type with the Swagger version produces a class with **zero fields** in the schema, and nothing errors at build time.

### 12.3 Docblocks vs comments — they are different tools

| | Docblock `/** */` | Comment `//` |
| :---- | :---- | :---- |
| **Answers** | What is this, how do I use it? | What must I not get wrong *here*? |
| **Audience** | The caller — reads it on hover, never opens the file | Whoever edits this line next |
| **Contains** | Description, usage, `@example`, `@param`/`@returns`/`@throws`, links to related symbols | A trap, a non-obvious constraint, a reason this line is not the obvious one |
| **Sits on** | The declaration — function, class, method, type, constant | The statement or expression it is about |

**MUST** — every exported symbol gets a docblock whose **first line says what it is**, in one sentence.

**MUST NOT** — put change history, migration notes, or "why this approach and not that one" in a docblock. That belongs in the commit message, the PR, or an ADR in [`decisions/`](./decisions/). A reader hovering a function wants its contract, not its biography.

**SHOULD** — put a genuine trap at the line it applies to, as a `//` comment, short enough to read in one pass.

**MUST NOT** — start a doc line with a bare `@`. TypeScript's JSDoc scanner opens a block TAG at any `@` preceded by whitespace, so `@grpc/proto-loader` or `@UseGuards(…)` ends the description there and turns the rest into a tag nobody declared — measured: `GRPC_LOADER_OPTIONS` had no description at all, and three decorators stopped at the colon introducing their own examples. Backtick it (`` `@UseGuards(…)` ``), which is correct anyway since a package name or a decorator IS code. Fenced blocks, indentation and moving the `@` mid-line do NOT help — only a non-whitespace character before it does. Prisma `///` docs are copied into the generated client, so the same rule binds there. `jsdoc-tags.spec.ts` enforces this.

**MUST NOT** — write a `/** */` where POSITION makes it attach to something other than what it describes. A docblock binds to whatever declaration follows it, and the failure is always the same shape: the text looks attached, is not, and the file reads as thoroughly documented while the symbol has nothing. Three instances, one rule:

- **Between a DTO property's decorators and its name.** The Swagger plugin runs with `introspectComments` and takes the LEADING comment, so a block below the decorators never reaches the published spec. `AcceptInvitationDto.deviceName` shipped with no description at all this way. A note about why a decorator is present or absent is a trap, so it belongs at that decorator as `//`; what the FIELD is belongs above them all. `dto-docblock.spec.ts` enforces this one.
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
| :---- | :---- | :---- | :---- |
| **Unit** | One class's logic in isolation — branches, edge cases, error paths | Never real; `PrismaService` is a mock | `*.spec.ts` beside the source |
| **E2E — auth-service** | A service's Prisma queries against a **real** Postgres — tenant scoping, soft-delete filters, partial unique indexes, transactions | Real, reset between tests | `apps/auth-service/test/*.e2e-spec.ts` |
| **E2E — api-gateway** | The gateway's full HTTP stack — guards, pipes, filters, interceptors, cookies, the envelope | None (gateway owns no database) | `apps/api-gateway/test/*.e2e-spec.ts` |

**"E2E" covers both**: no mock stands between the test and what a real request actually does inside that service.

**Both e2e suites run with `--runInBand`, always** — auth-service's shares one Postgres database, the gateway's shares one bound HTTP port. Parallel workers racing on either produce the "fails only sometimes, never under a debugger" symptom. Bake it into the npm script, not into someone's memory.

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

**Point at a dedicated test database, never the dev one.** `apps/auth-service/.env.test` sets `DATABASE_URL` to a separate database. A suite that can reach the developer's own data is one typo away from truncating it.

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

### 13.4 E2E (api-gateway) — the gateway's stack, with the peer stubbed

Register the **exact same** global filters/interceptors/pipes `main.ts` does. A suite that skips `ValidationPipe` and asserts a 400 is asserting on code that never runs in production.

```ts
export async function bootstrapE2eTest(overrides?: (b: TestingModuleBuilder) => void) {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  overrides?.(builder);

  const app = (await builder.compile()).createNestApplication();
  app.use(cookieParser());
  app.useGlobalFilters(new AllHttpExceptionFilter(false));
  app.useGlobalInterceptors(new LoggingInterceptor(false), new TransformInterceptor(app.get(Reflector)));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  await app.init();
  return { app };
}
```

**Override the gRPC client provider, not the network call** — never require a live `auth-service` process:

```ts
const { app } = await bootstrapE2eTest((builder) =>
  builder.overrideProvider(AUTH_GRPC_CLIENT).useValue({ getService: () => authGrpcStub }),
);
```

**Use a `supertest` agent to carry cookies across a multi-step flow**, and assert the FLAGS, not just the status — a 200 with the wrong branch of `settleLogin()` taken is a passing test hiding a broken login:

```ts
const agent = request.agent(app.getHttpServer());
const loginRes = await agent.post('/api/v1/auth/login').send(loginDto).expect(200);

const cookies = loginRes.get('Set-Cookie') ?? [];
expect(cookies.some((c) => c.startsWith(`${accessCookieName}=`) && c.includes('HttpOnly'))).toBe(true);
expect(cookies.some((c) => c.startsWith(`${twoFaCookieName}=`))).toBe(false);
```

**Assert on the envelope**, not the raw body (§5.1). A test reaching into `res.body.data` without checking `res.body.success` will pass on an error response that happens to carry a `data` key.

### 13.5 What never gets mocked, and what always does

| Always mock | Never mock |
| :---- | :---- |
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

A **source scan** is a test that reads the tree — the shape used by
`limit-comparison.spec.ts`, `default-branch-pairing.spec.ts`,
`mapper-naming.spec.ts` and `analytics-window.spec.ts`. It proves that text
**exists**, never that it **runs**. That single limit decides where it belongs.

Before writing one, ask **what the property actually is**:

| Property | Guard |
| :--- | :--- |
| **Testable per instance, quantified over ALL instances** | **Both.** The test covers a site; the scan covers the "every". |
| Has no runtime expression at all | **The scan is the only guard.** |
| Has a runtime expression; the scan stands in for a test | **Incomplete — write the test and drop the scan.** |

**The first row is the common case here, and the one where the proxy creeps
in:** it is easy to pick the instance, write a scan for it, and end up with
neither guard. `limit-comparison.spec.ts` is the clean example — *"this site
refuses a `NaN` limit"* is testable at any one of seven call sites, while
*"every site, including the one added next year"* is not testable at all. Write
both; they guard different things.

**The second row is why scans exist.** `FREE_TIER_ENTITLEMENTS` referencing
`MAX_DOCUMENTS_PER_TENANT` rather than the literal `100_000` has **no runtime
expression** — measured, the two are indistinguishable until the constant moves,
which is the moment nobody is looking. Same for *"the mapper branch was
deleted"*: both arrangements put identical bytes on the wire. No test can be
written that fails today, so the scan is not scaffolding — it is the guard.

**The third row is the ceiling.** Measured: `if (false && days > maxRangeDays)`
still matches a source pattern looking for that comparison. A scan cannot see
that the text does not run, so a behavioural property guarded only by a scan is
guarded only in appearance. `analytics-window.spec.ts` moved OUT of this row
when the two windows were unified: sharing `parseAnalyticsRange` made *"both windows
resolve identically"* true by construction, and what was left to guard —
*"neither service has grown a local copy back"* — has no runtime expression.
The replacement is better because the property changed underneath it.

**Every scan MUST carry its own vacuity guards**, because the failure mode of a
scan is silence:

- **A corpus floor.** A walk over zero files reports exactly what a clean repo
  reports. Assert the file count, and name one file that must be in it.
- **A pattern-fires test.** Assert the detector matches the shape it was written
  for, and does NOT match the corrected form. Without it, test 2 passes for a
  regex that matches nothing.

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
npm run test             # unit
npm run test:e2e         # the suites for the services you touched
```

Two failure modes this ordering exists to prevent:

- **Running tests over a tree that does not compile.** Jest transpiles per-file with SWC and does **not** typecheck, so a broken signature can pass every test and fail the build. `typecheck` is first for that reason alone.
- **Reporting a check you did not run.** "Tests pass" after editing only a `.py` file means `npm run test` said `--passWithNoTests`. Name the suite you ran, or run `test:py` too.

**Any box below that a command can decide, let the command decide.** The boxes are for the properties no command can see.

### Reuse

- [ ] Searched `libs/` before writing any helper; anything cross-service lives there.
- [ ] Any source scan added carries a corpus floor AND a pattern-fires test, and guards a property that has no runtime expression — or is paired with the test that does (§13.8).
- [ ] No duplicated enum, timestamp conversion, metadata key, or hashing helper.

### Security & tenancy

- [ ] Identity from `@CurrentUser()`, never from client input.
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
- [ ] gRPC calls go through `BaseGrpcClient.call()` with an origin.
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
- [ ] **Something ALERTS when it stops.** Adding a member to `SCHEDULED_JOBS` leaves `docker/prometheus/job-alerts.yml` a job short until it is regenerated — `npm run build -w @synapsedesk/common && node scripts/generate-job-alerts.mjs`. The build comes first because the generator reads the BUILT lib, and a stale one silently emits the old job list.

### Surface

- [ ] Handler returns raw data; message via `@ResponseMessage` or `res.locals`.
- [ ] DTOs cover every accepted field (`forbidNonWhitelisted` 400s otherwise).
- [ ] Request DTOs live in `<entity>.dto.ts`, response DTOs in `<entity>-response.dto.ts`, and every response class ends `ResponseDto` (§12.1).
- [ ] A `?` dropped in favour of a default carries `@ApiPropertyOptional()`, the default satisfies the field's own validators, and the proto field it feeds is **not** `optional` (§5.2).
- [ ] List endpoint extends `SearchPaginationDto` and returns `PaginationResponseDto<T>`.
- [ ] New env var added to the Joi schema **and** `env.example`.
- [ ] New permission code added to `PERMISSION_CODES` + `PERMISSION_NAMES` + role grants + [api-endpoints-plan.md §9](./api-endpoints-plan.md).
- [ ] Endpoint documented in [api-endpoints-plan.md](./api-endpoints-plan.md); schema change reflected in [rdm-specs.md](./rdm-specs.md) — **columns, types, nullability, defaults and the enum's full value list.** A widened enum whose doc still lists the old members is the most common drift and the least visible.
- [ ] New cross-service behaviour — an ordering constraint, a dial-out direction, a consistency sweep — recorded in [reference/sys-flows.md](./reference/sys-flows.md). Anything visible inside one service does **not** go there.
- [ ] `npm run lint` clean.

### Docs & comments

- [ ] Every exported symbol has a docblock whose first line says what it is (§12.3).
- [ ] No design rationale, history, or migration note inside a docblock — it went to an ADR or the PR.
- [ ] Traps sit as `//` comments on the line they apply to.

### Testing

- [ ] Unit tests mock `PrismaService` and every collaborator; nothing touches a real database.
- [ ] A new Prisma query with tenant or soft-delete filtering has an **e2e** test against a real test database (§13.3).
- [ ] Test database reset runs in `beforeEach` and uses the right strategy for the service (§13.3, Golden Rule 12).
- [ ] New factory functions carry the uniqueness counter for every `@unique`/partial-unique field.
- [ ] New gateway endpoint has an e2e test asserting the **envelope**, not just the HTTP status.
- [ ] `describe`/`it` titles follow §13.1.
- [ ] `jest.clearAllMocks()` in `afterEach`.
- [ ] Any RPC this PR adds is executed by a test in the service that **owns** it (§13.6).

---

## 15. Related Documents

See [README.md](./README.md) for the full map: core specs, `decisions/`, `reference/`, and the numbered implementation plans.

When a rule here conflicts with the code, one of them is wrong — say which in the PR rather than silently following the other.
