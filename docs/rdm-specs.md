# **Enterprise Relational Data Model (RDM) Specification**

**System Name:** SynapseDesk Backend

**Database Engine:** PostgreSQL 15+

**ORM Target:** Prisma ORM

## **1. Core Architecture Concepts & Clarifications**

### **1.1 Organizations vs. Departments (Multi-Tenancy Model & Request Scoping)**

* **organizations (Tenant Boundary):** Represents the top-level corporate entity or customer paying for the SaaS (e.g., *Acme Corp*, *TechGlobal Inc.*). Every single record in the system (users, tickets, documents) belongs to an organization. This guarantees strict multi-tenant data isolation.
* **Request Scoping & Data Isolation:** Every HTTP, GraphQL, or WebSocket request to the API server MUST carry an authenticated JWT token containing the organization_id and user_id. Middleware/Guards enforce that all database queries automatically scope filtering by organization_id.
* **departments (Functional Sub-Units):** Represents internal operational groups within an organization (e.g., *IT Helpdesk*, *HR & Payroll*, *Billing*, *Legal*). Users can belong to multiple departments via the user_departments table, with one designated as their primary department. Departments are used for:
  1. **Ticket Routing:** Directing escalated tickets to specific agent queues.
  2. **Granular Knowledge Scoping:** Restricting document chunk retrieval during RAG queries based on all departments a user is affiliated with.

### **1.2 Many-to-Many Document Scoping (department_documents)**

To support flexible document access control across teams:

* **Organization-Wide Access:** If a document's is_organization_wide flag is set to true, all users and RAG queries within that tenant can access it.
* **Department-Scoped Access:** If is_organization_wide is false, the document is linked to one or more specific departments via the **department_documents** junction table.
* **RAG Retrieval Scoping Filter:** During vector retrieval in Qdrant/PostgreSQL, the system applies metadata filtering based on the organization and the user's assigned departments.

### **1.3 Conversation History Engine (tickets & ticket_messages)**

All conversation threads—whether between a customer/employee and the AI assistant (Tier 1) or between an end-user and a human support agent (Tier 2)—are stored in **ticket_messages**.

* **Tier 1 (AI Self-Service):** When a user asks a question, a lightweight ticket record is created (or retrieved). The user's prompt and the AI's response are inserted into ticket_messages with is_ai_generated = true.
* **Tier 2 (Human Agent Escalation):** If the AI cannot resolve the issue and the user requests human help, the *same* ticket status changes to ESCALATED. When a human agent enters the thread, their replies are stored in ticket_messages with their sender_id.
* **Unified History:** This structure ensures a single chronological timeline of every interaction, allowing agents to see exactly what the user asked the AI before human intervention.

### **1.4 Relational DB vs. Vector DB (document_chunks & Citations)**

* **Vector DB (e.g., Qdrant):** Stores high-dimensional dense vector embeddings optimized for high-speed mathematical vector similarity search.
* **Relational DB (document_chunks in PostgreSQL):** Stores the relational ground truth:
  1. The raw text snippet (content_text).
  2. Sequential position (chunk_index, page number, section header).
  3. The link back to the parent document_id.
  4. The vector_point_id mapping directly to Qdrant.

**Why keep document_chunks in PostgreSQL?**

When the AI generates an answer, it must provide accurate, clickable citations (e.g., *"Source: 2026 Employee Handbook, Page 4, Paragraph 2"*). PostgreSQL handles metadata queries, join operations, and foreign key integrity far better than a vector database.

### **1.5 Purpose of device_sessions & Security Features**

The **device_sessions** entity serves two distinct security purposes:

1. **Active Session & Refresh Token Revocation:** Stores active refresh token hashes, client IP addresses, and user agents. If a user's laptop is stolen, they can click "Log out of all devices," which invalidates these session rows.
2. **2FA "Remember This Device" (Trusted Devices):** When a user completes Two-Factor Authentication (2FA), they can check "Remember this device for 30 days." A unique cryptographic token is issued and stored as device_token_hash with is_trusted = true. Future logins on that specific browser bypass the 2FA prompt until trusted_until is reached.

**Refresh Token Rotation & Reuse Detection (family_id + rotated_at):**

Refresh tokens are single-use. Each `/auth/refresh` call issues a new token and marks the presented row spent by setting rotated_at, while carrying family_id forward unchanged. This yields the standard OAuth 2.0 BCP replay defense:

* **The spent row is kept, not deleted.** This is the entire mechanism. If a rotated row were deleted, a stolen token replayed later would simply look like an *unknown* token — indistinguishable from a typo or an expired login, and silently ignored. Because the row survives with rotated_at set, the server can tell "this token was genuinely issued and has already been used," which is only possible if two parties hold it.
* **On reuse, revoke the family, not the row.** By the time a replay is observed, the legitimate client and the attacker have both been issued tokens in the same lineage, and there is no way to tell which is which. Revoking every row sharing that family_id logs both out and forces a fresh authentication that the attacker cannot complete.
* **Trust survives rotation.** device_token_hash and trusted_until are separate columns precisely because the refresh token changes on every use while a 30-day device trust must not. Binding trust to refresh_token_hash would silently break 2FA bypass on the first refresh.

**Why SHA-256 and not bcrypt/Argon2 for these hashes:**

refresh_token_hash, device_token_hash, and password_reset_tokens.token_hash are all UNIQUE columns looked up **by value** — the server receives a token and must find its row in one indexed read. bcrypt and Argon2 embed a random salt, so the same input hashes differently every time and could never be found by such an index; verification would require scanning every row and comparing one by one. SHA-256 is the correct choice here, not a compromise: these are 32 bytes of cryptographic randomness, and the slow-KDF family exists to protect *low-entropy human passwords* from offline guessing — a threat that does not apply to a 256-bit secret. users.password_hash remains Argon2/bcrypt, where that threat is real. Hex SHA-256 is fixed-width, hence VARCHAR(64).

### **1.6 Standard Audit & Soft-Delete Fields Policy**

To support enterprise compliance, legal hold requirements, and prevent accidental data loss:

* **Timestamps on All Tables:** Every table includes created_at (TIMESTAMPTZ) and updated_at (TIMESTAMPTZ).
* **Soft Deletes on Core Business Entities:** Operational tables (users, documents, tickets, departments, organizations) **MUST NOT** be hard-deleted from the database via SQL DELETE. Instead, they use:
  * deleted_at (TIMESTAMPTZ, Nullable): NULL means active; a timestamp indicates when it was soft-deleted.
  * deleted_by_id (UUID, Nullable): FK pointing to users.id who deleted the record.
* **Why Soft Delete?** If an administrator deletes a document, historical support tickets that cited that document must still preserve their relational integrity and citation logs.

### **1.7 Platform Super Admins vs. Tenant Users**

The system distinguishes two classes of identity:

* **Tenant User:** users.organization_id is set and is_super_admin = false. Every query is scoped to that organization_id by the middleware described in 1.1.
* **Platform Super Admin:** users.organization_id is NULL and is_super_admin = true. Employed by the SaaS provider to operate across tenants (onboarding, suspension, platform configuration). Their actions write audit_logs rows with a NULL organization_id, since no single customer owns the event.

The two conditions are kept in lockstep by a CHECK constraint (see Table 3) so an orphaned user record can never be mistaken for a platform operator.

### **1.8 Tenant Lifecycle, Quotas & Metering**

* **Lifecycle:** organizations.status gates tenant-wide access — PENDING_ONBOARDING (signed up, setup incomplete), ACTIVE (normal), SUSPENDED_PAST_DUE (payment failure; read-only or blocked), FROZEN (platform maintenance or compliance hold).
* **Seat & Storage Quotas:** max_agent_seats is checked before issuing an agent invite, counting **active agents + outstanding PENDING invitations** — counting only active agents would let an admin send 50 invites against 10 seats and blow the quota the moment they are accepted. The same total is re-checked at acceptance, since seats may have filled in the interim. Expired invitations release their reservation automatically (Table 28). max_storage_bytes is checked against the sum of documents.file_size_bytes before accepting an upload.
* **AI Token Metering:** monthly_ai_token_budget is enforced against the tenant's spend since billing_cycle_start, summed from **`ai_generations` (Table 29)** — *not* from `ticket_messages`, which only ever sees chat answers and is blind to drafts, summaries, classifications and embeddings. Reaching the cap disables AI generation while leaving human Tier 2 support fully available; the per-surface consequences of that, and why the runtime check is a Redis counter rather than this sum, are §1.14.
* **Security Governance:** enforce_two_factor forces every user in the tenant through 2FA enrollment at login. allowed_email_domains restricts which email domains may auto-join the tenant at signup.

### **1.9 Short-Lived Credential Flows (otps & password_reset_tokens)**

Three flows need a single-use secret that lives outside the JWT lifecycle. They are deliberately split into two tables because their delivery channel, format, and threat model differ.

* **otps (numeric codes, user-typed):** A 6-digit code delivered to a channel the user must prove they control — email (purpose = EMAIL_VERIFICATION) or SMS (purpose = PHONE_VERIFICATION). Because the code is short enough to guess, the row carries its own brute-force counter: every failed verification increments attempts_count, and once it reaches max_attempts (default 5) the handler sets is_used = true, burning the code and forcing a new request. Only the SHA-256 code_hash is stored.
* **The target column:** The code is bound to the *exact* address or number it was sent to, stored separately from users.email / users.phone_number. This is what makes a **change-of-address** flow safe: a user requesting a new phone number gets an OTP with target = the new number, and users.phone_number / is_phone_verified are only written after that specific code verifies. A code issued for one target can never validate a different one.
* **password_reset_tokens (opaque links, machine-generated):** A high-entropy token embedded in a reset URL, so it needs no attempt counter — guessing is infeasible. token_hash is UNIQUE, which makes lookup a single indexed read and makes token collision a database-level impossibility. ip_address and user_agent record where the reset was requested from; both are surfaced in the reset email ("this request came from Chrome on macOS") so a victim can recognize an attack, and are copied into audit_logs.
* **Shared invariants:** Both tables are consumed once (is_used) and expire (expires_at) — a row is valid only when `is_used = false AND expires_at > NOW()`. Both hard-delete via ON DELETE CASCADE from users, since an expired secret has no historical or compliance value. A scheduled job prunes rows past expires_at. Successfully consuming a password reset revokes every device_sessions row for that user.
* **Hashing choice differs between the two:** password_reset_tokens.token_hash is SHA-256 because it is a UNIQUE column looked up *by value* (§1.5). otps.code_hash is **not** — it is found via the (user_id, purpose) index and only then compared — so it is free to use a slow KDF, and should: a 6-digit code has ~20 bits of entropy, exactly the low-entropy case bcrypt/Argon2 exists for. The attempts_count ceiling is the online defense; a slow KDF is the offline one should the table ever leak. This is why code_hash is VARCHAR(255) rather than the fixed VARCHAR(64) of the SHA-256 columns.
* **Why not one generic tokens table?** A single table would force the numeric-code attempt counters and the URL-token provenance columns to be nullable for half its rows, and would let a low-entropy 6-digit code be presented where a high-entropy reset token is expected. Separate tables make that class of confusion unrepresentable.

### **1.10 Multi-Tenant Identity & Email Scoping**

`users.email` is unique **per tenant**, not globally. The pair `(organization_id, email)` is the identity key.

**Why.** A globally unique address makes one human equal to one tenant, permanently, and that breaks three flows the product depends on:

1. **Contractors and consultants.** An outsourced support specialist at `agency.com` serving two client tenants cannot exist under a global constraint — yet cross-domain users are the main reason the invitation flow exists at all (their address never matches `allowed_email_domains`, so they can never self-register).
2. **Re-hires and inherited mailboxes.** Soft-deleting a departing employee retains the row (§1.6), which under a global unique index keeps their address locked forever. A returning employee, or a new hire inheriting a shared mailbox such as `support@acme.com`, hits a confusing conflict with no remedy short of a hard delete the system deliberately never exposes.
3. **Tenant offboarding.** Soft-deleting a tenant leaves every one of its users holding their addresses hostage against any future tenant.

**How it is enforced.** Three partial unique indexes — partial, so **none** can be declared in `schema.prisma` (Prisma's `@@unique` compiles to a full index with no `WHERE` support). All three are applied by `applyPartialIndexes()` in the auth-service seed, so that `db push --force-reset` cannot silently drop them and leave a schema that *looks* correct with the constraint gone:

* **`users_org_email_key`** — `(organization_id, email) WHERE deleted_at IS NULL`. The `deleted_at` filter is what frees an address when a user is deactivated, fixing the re-hire case.
* **`users_super_admin_email_key`** — `(email) WHERE organization_id IS NULL AND deleted_at IS NULL`. Postgres does not treat NULLs as equal, so Super Admins need their own guard — the identical split already applied to `roles.name` (Table 5).
* **`user_invitations_pending_key`** — `(organization_id, email) WHERE status = 'PENDING'`. One outstanding invite per address per tenant; a revoked or expired one must not block a fresh one.

**Addresses are normalized with `normalizeEmail()` (trim + lower-case) at *every* entry point** — register, login, invite, forgot-password, Google sign-in, seed. The index is byte-exact: if one path lower-cases and another does not, `John@acme.com` and `john@acme.com` become two rows in one tenant and the constraint never fires.

**What it costs: login is no longer unambiguous.** `POST /auth/login` receives an address that may resolve to accounts in several tenants, so the flow gains a disambiguation step:

1. Load every non-deleted user row matching the lower-cased address (across tenants).
2. Verify the supplied password against each candidate. **Always evaluate every candidate** — short-circuiting on the first match leaks, by response time, how many tenants an address belongs to.
3. **Zero** matches → generic `401`. Never reveal whether the address exists.
4. **Exactly one** match → issue the session as before. This is the overwhelmingly common path; a normal employee never sees step 5.
5. **More than one** match (the user reused a password across tenants) → return `{ requiresTenantSelection: true, tenantSelectionToken, tenants: [{ id, name, slug }] }`. The client re-posts to `POST /auth/login/tenant` with the chosen `organization_id`.

`tenantSelectionToken` is a short-lived (5 min) signed token carrying the already-verified candidate user ids. It is what stops the selection endpoint from becoming an unauthenticated "which tenants own this address?" oracle — the tenant list is only ever emitted *after* a password has verified.

**Ordering against 2FA.** Tenant selection resolves first, then the 2FA challenge, because `organizations.enforce_two_factor` is a per-tenant setting and cannot be evaluated before the tenant is known.

**Other flows that inherit the ambiguity:**

* **Password reset** (`POST /auth/password/forgot`) — one address may map to several accounts. Issue one `password_reset_tokens` row per matching user and send a **single** email containing one clearly labelled link per organization. The response stays `202` regardless, preserving the no-enumeration guarantee.
* **OAuth callback** — the provider returns a verified address, not a tenant. Resolve the tenant from the `state` parameter seeded at initiation (org slug or invitation token); fall back to the same tenant-selection response when the address matches multiple tenants.
* **Registration** — the "already registered" check narrows from *this address exists* to *this address exists **in the tenant being joined***.

**The index is the enforcement; the service check is the error message.** Application-layer pre-checks remain necessary for a good `409`, but they are **not** what makes a duplicate impossible — two concurrent registrations can both read "no conflict" and both insert. Only the index closes that race, which is why the `P2002` catch around the insert is mandatory rather than defensive.

### **1.11 Invitations (Table 28)**

Tokenized offers of tenant membership, keyed to `(organization_id, email)` rather than a `user_id` — the recipient has no account yet, which is the entire point: invitations exist mainly to onboard people whose email domain does **not** match `allowed_email_domains`, so they could never self-register.

`role_ids` / `department_ids` are **proposals**, stored as arrays rather than FK relations and validated at redemption: anything deleted during the window is skipped and reported, never fatal. A department deleted on day 3 must not strand a legitimate invitee on day 6.

PENDING invitations **reserve seats** against `organizations.max_agent_seats` (§1.8); expiry is what releases the reservation. Invitations transition to `EXPIRED` rather than being deleted, so the onboarding funnel stays measurable — "16 of 47 invitees never accepted" is a metric, not garbage.

### **1.12 Notification Fan-Out & Real-Time Delivery (Tables 23–25)**

Domain E turns a domain event into (a) a durable per-recipient feed row and (b) a live push to whatever sockets that user has open. The three tables split by *what changes independently*:

* **`notifications`** — one row **per recipient**, not per event. A ticket assigned to an agent and watched by three others is four rows. Fan-out at write time makes the feed query a single indexed `WHERE recipient_id = $1`, which is the query that runs on every page load; the alternative (one event row + a join to compute visibility) makes the hot path the expensive one.
* **`notification_deliveries`** — one row per (notification, channel). Separate because *sent* and *read* are different facts on different clocks: an email can be `DELIVERED` while the notification stays unread for a week, and a `SKIPPED` row with `skip_reason = 'quiet_hours'` is an auditable decision rather than a silent drop.
* **`notification_preferences`** — resolved per (type, channel) with fallback: exact match → `('*', channel)` → hard-coded default. Storing only explicit overrides keeps a new user's preference set empty rather than pre-populated with dozens of rows that then drift from the defaults they were copied from.

**Idempotency is not optional.** NATS JetStream is at-least-once, so the same `ticket.assigned` can arrive twice. `notifications.event_id` carries the producer's event id under `UNIQUE (recipient_id, event_id) WHERE event_id IS NOT NULL` — the consumer upserts on it. Without this, every redelivery is a duplicate toast.

**Grouping is what keeps the feed usable.** Twelve messages on one ticket collapse into one row via `group_key` (`ticket:123:message`) with `group_count` incremented, rather than twelve rows. This is why the WS contract needs a `notification:updated` event alongside `notification:new` — a coalesced update must edit the existing toast in place, and a client that only knows `new` will stack twelve of them regardless of what the database did.

**Read state is per-row and therefore cross-device.** One user may hold several sockets (laptop, phone, second tab), all joined to `user:{userId}`. Marking a notification read on one must push `notification:read` to the rest, or the badge count silently disagrees between devices until a refresh. The same reasoning makes `notification:unread-count` worth pushing rather than polling — a locally incremented counter drifts the moment two devices act.

**No `deleted_at` (exception to §1.6).** Notifications are inherently ephemeral: `archived_at` handles user dismissal and `expires_at` drives the pruning job. Soft-delete exists to preserve referential integrity for things that get cited later; nothing cites a notification.

### **1.13 Cross-Service References Carry No Database Foreign Key**

Every table below marked **FK ➔ users.id**, **FK ➔ departments.id**, or **FK ➔ organizations.id** is annotated that way for readability — it names the *logical* relationship — but only tables that live inside `auth-service`'s own database (`postgres_auth`) can enforce it as a real Postgres constraint. `tickets`, `ticket_messages`, `ticket_assignments` (Domain B) and `ai_response_feedbacks`, `audit_logs` (Domain D, owned by `ticket-service` per the service ownership map) live in a **separate physical database**, `postgres_ticket`. Postgres cannot enforce a foreign key across databases, full stop — this is not a gap to close later, it is the correct shape for service-per-database.

**The obligation this creates, in place of a constraint:**

1. **Validate at write time, over gRPC, not at read time via FK.** Before `ticket-service` inserts a ticket, it calls `auth-service`'s `UserService.GetUser` to confirm `author_id` resolves in the caller's tenant. Before an assignment, `DepartmentService.GetDepartment` for the target department. This check happens once, at the moment the id is accepted into a write — never again afterwards.
2. **Never re-validate after the write, and never build a job to detect "orphans."** `users`, `departments` and `organizations` are **never hard-deleted** (§1.6) — only soft-deleted — so a reference recorded once remains resolvable forever. A locked agent's historical tickets still correctly show who handled them. There is no dangling-reference case for a reconciliation job to find, because the thing that would normally cause one (hard delete) cannot happen.
3. **`ON DELETE CASCADE` / `SET NULL` annotations on these columns are aspirational, not literal.** They describe what the *application* does when it observes the referenced row change state (e.g., a soft-deleted user's `deleted_by_id` references elsewhere are left alone, since nothing enforces the alternative) — read them as intent, not as DDL that exists on the `ticket_messages`/`tickets`/`ticket_assignments` tables themselves.

Full reasoning: [ADR 0022](./decisions/0022-no-cross-service-fks.md).

### **1.14 AI Metering, Cost and the Quota Gate (Table 29)**

**Every LLM and embedding call is logged to `ai_generations`.** Not just the ones that produce a visible message — drafts, summaries, classifications, greeting-intent checks, query reformulations and ingestion embeddings are all real spend, and a budget that cannot see them is not a budget.

**Meter money, not tokens.** `monthly_ai_token_budget` is denominated in tokens, and cost per token varies by an order of magnitude across model tiers. If a tenant's generation model changes, the same token count costs several times the money — the quota stops describing cost and starts protecting a number that no longer means anything. `ai_generations.estimated_cost_micros` is therefore computed at write time from `model_name` and the token counts, and **the budget is enforced against cost**. The column name `monthly_ai_token_budget` is kept for continuity; read it as "the tenant's monthly AI allowance," denominated internally in micros.

*(The lighter alternative — exposing model **tiers** rather than models, each with a multiplier applied to metered tokens: `FAST = 1×`, `QUALITY = 8×` — keeps the token unit and prevents a tenant pinning a model that later gets deprecated. Either approach works; what does not work is letting model choice float while budgeting raw tokens.)*

**The runtime check cannot be the definition.** `SUM(estimated_cost_micros) WHERE organization_id = ? AND created_at > billing_cycle_start` is the *correct definition* of spend and an *unacceptable* hot-path query — a growing scan on every AI request. Enforcement is:

* **Runtime gate:** a Redis counter keyed `quota:{organizationId}:{billingCycleStartEpoch}`, incremented after each generation. O(1), and the cycle in the key means a cycle roll invalidates it for free.
* **Reconciliation:** a scheduled job re-derives the sum from `ai_generations` and corrects the counter. Redis is the fast answer; the ledger is the true one.

**Charging and recording are two operations, and only one of them may be asynchronous.** The natural implementation writes the ledger row and bumps the counter in one fire-and-forget call — and that reopens the hole the counter exists to close. If the counter increments asynchronously, N concurrent requests during a burst all read the same stale value, all pass the gate, and all spend; reconciliation discovers it afterwards, which is after the money is gone. The split:

| Operation | Latency budget | Failure mode |
| :---- | :---- | :---- |
| **Charge** — `INCRBY quota:{org}:{cycle}` | **Synchronous, awaited.** Sub-millisecond, safe on the hot path | Redis down → fail closed on the gate, not silently open |
| **Record** — the durable `ai_generations` row | Fire-and-forget, never awaited | Swallowed and logged; reconciliation restores agreement |

The consequence for a service that spends: it increments Redis **directly**, not through the service that owns the ledger table. A cross-service hop to charge would put a network round trip on every AI request to save duplicating one key format — the wrong trade. The key format is therefore a shared constant with a contract test on both sides, since it now has a TypeScript and a Python implementation.

**Cancelled work still spent money, and the naive implementation loses exactly those rows.** A cancelled chat stream fires a `CANCELLED` ledger write — but if that write is a child task of the request being cancelled, cancellation kills it too. Partial generation is real spend, so the ledger write must survive its parent (`asyncio.shield`, or an out-of-band queue). Worth stating because the obvious implementation is the broken one and it fails silently in the direction of under-counting.

**Reaching the cap is an operational event for the tenant, not a billing footnote.** If self-service is deflecting 70–80% of questions, disabling AI means **every one of those questions becomes a ticket** — a 3–5× overnight spike in agent queue volume. Threshold alerts must say that in those words, because "you have used 80% of your AI budget" prompts nobody to act, while "at 100%, all self-service questions will route to your agents" does.

* **Ladder:** 80% / 95% / 100%, to users holding `organization.update`, not the whole tenant.
* **Idempotency comes free from the existing schema.** `notifications.event_id` under `UNIQUE (recipient_id, event_id)` (Table 23) with
  `event_id = "quota:{organizationId}:{billingCycleStartEpoch}:{threshold}"`
  fires each threshold exactly once per cycle with no extra bookkeeping — and because `billing_cycle_start` is in the key, a cycle reset re-arms every alert automatically.
* **100% uses `priority = CRITICAL`** so it bypasses quiet hours and digest batching (Table 25).

**Per-surface behaviour at the cap** — decided here rather than discovered at runtime:

| Surface | At cap |
| :---- | :---- |
| `POST /tickets/:id/ai/draft`, `/classify`, `/suggestions` | **402.** The agent works manually. No product change, no data loss. |
| `POST /tickets/:id/ai/summary` — **manual** | **402.** Discretionary. |
| `/ai/summary` — **auto-invoked on escalation** | **Allowed, inside a bounded grace of 10% over budget**, then 402 like the rest. See the compounding-failure note below. |
| `POST /chat/conversations/:id/messages` | **Persist the user's message, then auto-escalate** — route to `default_department_id` and tell the user a human will respond. "AI disabled" alone would leave a question sitting unanswered, which is worse than a slower answer. |
| Greeting detection, Layer 2 | **Stops** — it is an LLM call. Regex-only; anything unmatched is treated as factual and follows the escalation path above. (Layer 1 and the greeting *reply* are free at any budget — see below.) |
| `POST /knowledge/search` | **Degrades to lexical-only, HTTP 200 with `degraded: "LEXICAL_ONLY"`.** The FTS arm needs no embedding and therefore costs nothing, so a Knowledge Manager can still confirm a document is indexed and reachable while the tenant is capped. A flat 402 would take away corpus diagnostics at the exact moment someone is trying to understand what happened. |
| `POST /knowledge/ask` | **402.** Retrieval could degrade as above, but the answer is a generation and there is no free version of it. |
| Ingestion embeddings | **`ingestion_jobs` stay `QUEUED`, resumed at cycle roll.** Not failed: a tenant who overspends on chat should not lose the ability to onboard documents, and failing the job would discard work already done. The intent — stop spending — is honoured either way. |

**At the cap, two failures compound, and the naive reading treats them as independent.** Deflection stops, so ticket volume spikes 3–5× — and every one of those tickets arrives *without* an AI summary, because `/ai/summary` is an AI surface too. Agents get several times the work with none of the context that makes them fast. Hence the grace row above: an escalation summary is among the cheapest calls the system makes and has the highest marginal value precisely when the queue is flooded, so it is the one surface worth letting run past the line. The grace is **bounded at 10%** rather than unlimited, because an unbounded exemption is not a cap. If the tenant burns through the grace as well, summaries stop too and the 100% alert says so.

**The greeting reply is a lookup, not a generation.** Detecting a greeting with a free regex and then paying an LLM to answer *"Hi! How can I help?"* spends money to produce one of about six sentences. The reply comes from a canned multilingual response table keyed by the language Layer 1 already detected: zero cost, zero latency, unaffected by the cap, and no ledger row because there is no spend. `purpose` therefore has no `GREETING_REPLY` value — if canned replies ever prove too rigid to ship, adding the value and ledgering it is the change, not leaving an unmetered call in place.

**Why `default_department_id` exists (Table 1).** The chat-at-cap row above needs a routing target, and the AI classifier that would normally choose one is disabled by the same condition. Without a configured default the fallback is the tenant's oldest active department; with no departments at all, the ticket lands unassigned in the org-wide queue rather than failing to escalate.

### **1.15 Billing, Entitlements and AI Tiers (Stripe, Table 30)**

**Two things that sound like one.** *Plan management* — who is on Starter vs Pro, what it costs, when it renews, whether the card cleared — is Stripe's job and is not modelled here. *Entitlements* — what a plan actually grants — are the five columns on Table 1. Stripe does not replace them; **it becomes the machine that writes them.**

**Keep exactly two Stripe columns.** `stripe_customer_id` and `stripe_subscription_id`. Mirroring price points, plan names or feature lists into Postgres creates two sources of truth that diverge the first time someone edits a price in the Stripe dashboard.

**The webhook is the entitlement writer, and it is the whole integration:**

```txt
customer.subscription.created | updated | deleted
   → map price id → { max_agent_seats, max_storage_bytes,
                      monthly_ai_token_budget, ai_model_tier }
   → set billing_cycle_start = subscription.current_period_start
   → map subscription.status → organizations.status
```

* **`billing_cycle_start` follows Stripe's `current_period_start`.** This changes the meaning of an endpoint that already exists: `POST /platform/organizations/:id/billing-cycle/reset` stops being routine tenant administration and becomes **break-glass only**, since a manual roll now desynchronizes the quota window from the invoice period. The endpoint stays — it is genuinely useful when a tenant is owed a reset after an incident — but it writes an audit row and says what it is.
* **The cycle epoch is load-bearing.** It is in the Redis quota key (§1.14), so anything that writes `billing_cycle_start` implicitly re-arms every quota threshold alert and zeroes the counter. That is the desired behaviour at a genuine renewal and a silent budget grant if it fires by accident — which is the second reason the manual endpoint is now break-glass.
* **`SUSPENDED_PAST_DUE` already is Stripe's `past_due`.** The tenant lifecycle enum was designed before billing existed and maps onto Stripe's subscription statuses without modification; §0.4's lifecycle gate is the enforcement mechanism that was already built for it. Mapping: `active | trialing → ACTIVE`; `past_due | unpaid → SUSPENDED_PAST_DUE`; `canceled | incomplete_expired → FROZEN`.

**Webhooks are at-least-once and arrive out of order, so entitlement writes need two guards** — this is the part that fails quietly and expensively:

* **Idempotency:** `billing_events.stripe_event_id` is `UNIQUE`. A redelivered event is a duplicate-key violation, not a second write.
* **Monotonicity:** a write is applied only if the event's `created` timestamp is newer than the last one processed for that subscription. Without this, a delayed `subscription.updated` carrying yesterday's Starter plan can land *after* today's upgrade to Pro and silently downgrade a paying tenant — the failure surfaces days later as "why did our seat limit drop?" with no error anywhere.

**Why AI tiers are deferred until after Stripe, despite being easy.** Not for §1.7's stated reason — "you cannot tune what you cannot measure" is correct for RRF weights and wrong for model tier, which is a price/quality trade a customer understands without any eval set. The real reason is that **a tier without billing is a support ticket**: "upgrade me" becomes a manual column edit by someone with database access. Once the webhook exists, the tier is one column behind an indirection that already exists, and it is the easiest thing in the product to sell.

**What Domain C must do now, and it is the only part that is expensive later.** Every model choice reads `settingsFor(organizationId).generationModel`, resolved from `ai_model_tier` with a global default — never a model-name literal at a call site. Doing this while writing the call sites costs roughly an hour of discipline; retrofitting it means auditing every LLM invocation across two services in two languages. **This is the one piece of the tier feature that is non-negotiable during Domain C**, and it is why `ai_model_tier` exists as a column before anything reads it.

*(The decision to meter `estimated_cost_micros` rather than raw tokens — §1.14 — is what makes a premium tier possible at all. Under token budgeting, adding a tier means re-deriving every historical figure and redefining what the budget column means. That door was closed correctly, before it cost anything.)*

---

## **2. Detailed Data Dictionary & Schema Specification**

```txt
| SYNAPSEDESK DOMAINS |

[ Domain A: Tenant & User ] ---> organizations, departments, users, user_departments, roles, permissions, user_roles, role_permissions, device_sessions, two_factor_backup_codes, otps, password_reset_tokens, user_invitations
[ Domain B: Support Engine ] ---> tickets, ticket_assignments, ticket_messages, message_attachments, ai_summaries
[ Domain C: Knowledge & RAG] ---> documents, document_flags, department_documents, document_chunks, ingestion_jobs
[ Domain D: Audit & Feedback] ---> ai_response_feedbacks, audit_logs, ai_generations, billing_events
[ Domain E: Notifications ] ---> notifications, notification_deliveries, notification_preferences
```

**30 tables.** Table numbers are **stable identifiers, not reading order** — they are cited from other documents (`api-endpoints-plan` §0.5, §1.1, §1.6, §9, §11) and from code docblocks, so a table keeps its number for life. Five were added after the original 1–25 were assigned and are placed in their *domain's* section rather than at the end, which is why the sequence reads 1–12, **28**, 13–16, **26**, 17–20, **27**, 21–25, **29–30**:

| Late addition | Sits in | Why it was added |
| :---- | :---- | :---- |
| **Table 26** `ticket_assignments` | Domain B | Assignment history — who held a ticket, when, and why it moved |
| **Table 27** `document_flags` | Domain C | Content-quality signals; replaced the un-backed `documents/stale` idea |
| **Table 28** `user_invitations` | Domain A | Invitations had endpoints but no table |
| **Table 29** `ai_generations` | Domain D | Every LLM call except chat answers was unmetered spend, and draft acceptance was uncomputable |
| **Table 30** `billing_events` | Domain D | Stripe webhooks are at-least-once and unordered; entitlement writes need idempotency and a monotonic guard (§1.15) |

Domain membership, not the number, is what tells you where a table belongs.

### **Domain A: Tenants, Identity & Access Control (RBAC)**

#### **Table 1: organizations**

*Top-level tenant entity representing the customer organization.*

| Field Name | Data Type | Constraints / Default | Description & Business Logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | Primary Key, gen_random_uuid() | Unique identifier for the tenant. |
| **name** | VARCHAR(255) | NOT NULL | Legal name of the company (e.g., "Acme Corp"). |
| **slug** | VARCHAR(100) | NOT NULL, UNIQUE, Indexed | URL-friendly identifier (e.g., acme-corp). |
| **domain** | VARCHAR(255) | UNIQUE, Nullable | Corporate email domain for auto-joining (e.g., acme.com). |
| **status** | ENUM | NOT NULL, Default: 'PENDING_ONBOARDING' | Tenant lifecycle state: PENDING_ONBOARDING, ACTIVE, SUSPENDED_PAST_DUE, FROZEN. Controls tenant-wide access during payment failure or platform maintenance. |
| **max_agent_seats** | INT | NOT NULL, Default: 10 | Seat quota enforced when an Org Admin invites new support agents. |
| **max_storage_bytes** | BIGINT | NOT NULL, Default: 5368709120 (5GB) | Storage quota for documents uploaded for RAG ingestion. |
| **monthly_ai_token_budget** | BIGINT | NOT NULL, Default: 1000000 | Hard cap on AI spend per billing cycle. Denominated internally in **micros of currency**, not tokens — the name is kept for continuity (§1.14). Written by the Stripe entitlement webhook (§1.15), not by hand. |
| **billing_cycle_start** | TIMESTAMPTZ | NOT NULL, NOW() | Anchor date for resetting AI usage back to 0. **Follows Stripe's `current_period_start`** once billing is live (§1.15) — it is load-bearing beyond its own column, since the Redis quota key embeds its epoch. |
| **ai_model_tier** | VARCHAR(20) | NOT NULL, Default: 'FAST' | `FAST \| QUALITY`. The generation-model entitlement — the sellable AI tier. Resolved into concrete model names by the settings layer (§1.15), **never** compared to a model string at a call site. Written by the entitlement webhook. Does not apply to the embedding model, which is fixed for the life of the Qdrant collection (§1.14, Table 19). |
| **stripe_customer_id** | VARCHAR(255) | Nullable, UNIQUE | Stripe `Customer`. NULL before the tenant ever reaches checkout. |
| **stripe_subscription_id** | VARCHAR(255) | Nullable, UNIQUE | Stripe `Subscription`. Plan *definitions* live in Stripe and are deliberately not mirrored here — see §1.15. |
| **enforce_two_factor** | BOOLEAN | NOT NULL, Default: false | Forces 2FA setup for every user in the tenant during login. |
| **allowed_email_domains** | VARCHAR(255)[] | NOT NULL, Default: '{}' | Array of domains (e.g., {acme.com, acme.org}) validated during signup auto-join. |
| **default_department_id** | UUID | Nullable | Fallback routing target for a ticket nobody has classified. Needed because the AI classifier that normally picks a department (`POST /tickets/:id/ai/classify`) is **itself disabled** when `monthly_ai_token_budget` is exhausted — precisely when auto-escalation volume spikes. NULL falls back to the tenant's oldest active department; a tenant with no departments at all leaves the ticket unassigned in the org-wide queue rather than failing the escalation. Logical reference only (§1.13 does not apply — `departments` is in the same database — but a hard FK would block deleting a department that happens to be the default, so this is enforced in the service layer instead: clearing the default is part of `DELETE /departments/:id`). |
| **created_at** | TIMESTAMPTZ | NOT NULL, NOW() | Timestamp when the organization was onboarded. |
| **updated_at** | TIMESTAMPTZ | NOT NULL, NOW() | Timestamp when tenant settings were last modified. |
| **deleted_at** | TIMESTAMPTZ | Nullable, Indexed | Timestamp if tenant was soft-deleted/offboarded. |
| **deleted_by_id** | UUID | Nullable, FK ➔ users.id | System admin who soft-deleted/offboarded the organization. |

* **Quota Enforcement:** max_agent_seats, max_storage_bytes, and monthly_ai_token_budget are checked at the application layer before invite, upload, and LLM invocation respectively. AI spend is summed from **`ai_generations.estimated_cost_micros` (Table 29)** since billing_cycle_start — *not* from `ticket_messages`, which sees only chat answers and is blind to drafts, summaries, classifications, reformulations and embeddings (§1.8, §1.14).
* **These five columns are entitlements, and Stripe writes them.** `max_agent_seats`, `max_storage_bytes`, `monthly_ai_token_budget`, `ai_model_tier` and `billing_cycle_start` are *what a plan grants*; which plan the tenant holds is Stripe's business, not a column here (§1.15).

#### **Table 2: departments**

*Internal operational sub-units within an organization.*

| Field Name | Data Type | Constraints / Default | Description & Business Logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | Primary Key, gen_random_uuid() | Unique identifier for the department. |
| **organization_id** | UUID | NOT NULL, FK ➔ organizations.id | Tenant isolation boundary. |
| **name** | VARCHAR(100) | NOT NULL | Department title (e.g., "IT Support", "HR", "Billing"). |
| **description** | TEXT | Nullable | Brief explanation of department responsibilities. |
| **created_at** | TIMESTAMPTZ | NOT NULL, NOW() | Creation timestamp. |
| **updated_at** | TIMESTAMPTZ | NOT NULL, NOW() | Modification timestamp. |
| **deleted_at** | TIMESTAMPTZ | Nullable | Soft-delete timestamp. |
| **deleted_by_id** | UUID | Nullable, FK ➔ users.id | Admin or manager who soft-deleted this department. |

#### **Table 3: users**

*Central identity entity for end-users, agents, and system admins.*

| Field Name | Data Type | Constraints / Default | Description & Business Logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | Primary Key, gen_random_uuid() | Unique identifier for the user account. |
| **organization_id** | UUID | Nullable, FK ➔ organizations.id | The enterprise organization the user belongs to. NULL identifies a SaaS Provider Super Admin operating across tenants. |
| **is_super_admin** | BOOLEAN | NOT NULL, Default: false | Explicit platform-level privilege flag. Must be paired with a NULL organization_id. |
| **email** | VARCHAR(255) | NOT NULL, Indexed | User login address, stored lower-cased. **Unique per tenant, not globally** — the same person may legitimately hold accounts in several tenants (a contractor serving two clients). See §1.10. |
| **is_email_verified** | BOOLEAN | NOT NULL, false | True if user verified email ownership via magic link/OTP. |
| **password_hash** | VARCHAR(255) | Nullable | Argon2/Bcrypt hash. Null if user authenticated via OAuth2. |
| **full_name** | VARCHAR(150) | NOT NULL | User's full display name (e.g., "John Doe"). |
| **avatar_url** | TEXT | Nullable | An **internal Firebase Storage object path** (`organizations/{orgId}/avatars/{userId}/{uuid}.{ext}`), not a URL — despite the column name, kept for historical continuity with earlier drafts of this spec. `storage-service` resolves it to a fresh short-lived signed URL at read time; see [ADR 0024](./decisions/0024-one-upload-mechanism.md). |
| **phone_number** | VARCHAR(30) | Nullable | Contact number for SMS alerts or 2FA. |
| **is_phone_verified** | BOOLEAN | NOT NULL, false | True if phone number was verified via SMS code. |
| **dob** | DATE | Nullable | Date of birth (optional profile/HR metric). |
| **gender** | VARCHAR(20) | Nullable | Gender identity (optional profile/HR metric). |
| **is_two_factor_enabled** | BOOLEAN | NOT NULL, false | True if TOTP/Authenticator app is enabled for login. |
| **two_factor_secret** | VARCHAR(255) | Nullable | Encrypted TOTP secret key. |
| **is_locked** | BOOLEAN | NOT NULL, false | True if account is suspended due to security violations. |
| **last_login_at** | TIMESTAMPTZ | Nullable | Timestamp of user's most recent successful authentication. |
| **created_at** | TIMESTAMPTZ | NOT NULL, NOW() | Account creation timestamp. |
| **updated_at** | TIMESTAMPTZ | NOT NULL, NOW() | Profile update timestamp. |
| **deleted_at** | TIMESTAMPTZ | Nullable | Soft-delete timestamp (account deactivation). |
| **deleted_by_id** | UUID | Nullable, FK ➔ users.id | Admin who deactivated this account. |

* **Super Admin Invariant:** Enforced via CHECK constraint `(organization_id IS NULL) = (is_super_admin = true)`. A tenant user must always carry an organization_id; a platform Super Admin must never carry one. This prevents an orphaned user record from being silently treated as cross-tenant.
* **Email Uniqueness (two partial indexes, §1.10):** Postgres does not treat NULLs as equal, so tenant users and Super Admins need separate guards — the same split already used by `roles` (Table 5).

  ```sql
  -- Tenant users: one account per address per tenant.
  CREATE UNIQUE INDEX users_org_email_key ON users (organization_id, email)
    WHERE deleted_at IS NULL;

  -- Platform Super Admins (organization_id IS NULL): one account per address.
  CREATE UNIQUE INDEX users_super_admin_email_key ON users (email)
    WHERE organization_id IS NULL AND deleted_at IS NULL;
  ```

* **Deactivation Frees the Address:** Both indexes are filtered on `deleted_at IS NULL`. Soft-deleting a departing employee releases their address for re-use, so a returning employee — or a new hire inheriting a shared mailbox like `support@acme.com` — can be re-invited without a hard delete. Without the filter the address stays permanently locked by a row the application already treats as gone.
* **Case Normalization:** `email` is lower-cased by the application before every write and lookup. Without it, `John@acme.com` and `john@acme.com` are distinct index entries and the same human receives two accounts in one tenant.

#### **Table 4: user_departments (Junction Table)**

*Maps users to one or multiple departments within an organization (Many-to-Many).*

| Field Name | Data Type | Constraints / Default | Description & Business Logic |
| :---- | :---- | :---- | :---- |
| **user_id** | UUID | Primary Key, FK ➔ users.id, On Delete CASCADE | User entity being assigned to a department. |
| **department_id** | UUID | Primary Key, FK ➔ departments.id, On Delete CASCADE | Department assigned to the user. |
| **is_primary** | BOOLEAN | NOT NULL, Default: false | Marks whether this is the user's primary department. |
| **assigned_by_id** | UUID | Nullable, FK ➔ users.id | Admin or manager who performed the assignment. |
| **assigned_at** | TIMESTAMPTZ | NOT NULL, NOW() | Timestamp when user was assigned to the department. |

* **Composite Primary Key:** (user_id, department_id)
* **Primary Department Constraint:** Enforced via Partial Unique Index on (user_id) WHERE is_primary = true (ensuring at most one primary department record per user).

#### **Table 5: roles**

*System and tenant-level custom roles for access control.*

| Field Name | Data Type | Constraints / Default | Description & Business Logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | Primary Key, gen_random_uuid() | Unique identifier for the role. |
| **organization_id** | UUID | Nullable, FK ➔ organizations.id | NULL = global system role shipped with the platform (Default Admin, Default Agent, Default Viewer). A UUID = custom role owned by that tenant. |
| **name** | VARCHAR(100) | NOT NULL | Role title (e.g., "Admin", "Tier 2 Agent", "Viewer"). |
| **description** | TEXT | Nullable | Human-readable explanation of the role's purpose, surfaced in the admin UI. |
| **is_system_role** | BOOLEAN | NOT NULL, Default: false | True for built-in roles. Protects them from deletion or mutation by tenant admins. |
| **user_assigned** | INT | NOT NULL, Default: 0 | Count of active users attached to this role. |
| **created_by_id** | UUID | NOT NULL, FK ➔ users.id | Admin user who created the role. |
| **created_at** | TIMESTAMPTZ | NOT NULL, NOW() | Timestamp when the role was created. |
| **updated_at** | TIMESTAMPTZ | NOT NULL, NOW() | Timestamp when role configuration was last updated. |

* **Composite Unique Constraint:** (organization_id, name) replaces the former global UNIQUE(name), so two tenants can each define a role named "Tier 2 Lead" without collision.
* **Note on NULL semantics:** PostgreSQL does not treat NULLs as equal in a unique index, so global system roles are additionally guarded by a Partial Unique Index on (name) WHERE organization_id IS NULL.

#### **Table 6: permissions**

*Atomic capabilities and feature authorization rules.*

| Field Name | Data Type | Constraints / Default | Description & Business Logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | Primary Key, gen_random_uuid() | Unique identifier for the permission. |
| **name** | VARCHAR(100) | NOT NULL, UNIQUE | Human-readable title (e.g., "Delete User Accounts"). |
| **code** | VARCHAR(100) | NOT NULL, UNIQUE, Indexed | Dot-notation string using target.action format (e.g., user.delete, ticket.escalate). |
| **created_at** | TIMESTAMPTZ | NOT NULL, NOW() | Registration timestamp. |

#### **Table 7: user_roles (Junction Table)**

*Maps users to their assigned roles (Many-to-Many).*

> ⚠️ **Implemented as a Prisma *implicit* many-to-many, so this table carries no extra columns.** `User.roles Role[] @relation("user_roles")` ↔ `Role.users User[] @relation("user_roles")` generates a relation table Prisma names **`_user_roles`** with exactly two columns, `A` and `B`. Implicit relation tables **cannot** hold payload columns — see the note below Table 8 for why this was accepted and where the provenance actually lives.

| Field Name | Data Type | Constraints / Default | Description & Business Logic |
| :---- | :---- | :---- | :---- |
| **A** (`user_id`) | UUID | FK ➔ users.id, On Delete CASCADE | User entity being assigned a role. |
| **B** (`role_id`) | UUID | FK ➔ roles.id, On Delete CASCADE | Role assigned to the user. |

* **Unique index on `(A, B)`** plus a lookup index on `(B)` — generated by Prisma, not declared.
* **Denormalized counter:** `roles.user_assigned` tracks membership size and **must** be maintained in the same transaction as every insert/delete here (see Table 5).

#### **Table 8: role_permissions (Junction Table)**

*Maps permissions to roles to establish Role-Based Access Control (Many-to-Many).*

> ⚠️ **Also an implicit many-to-many** — Prisma table **`_role_permissions`**, columns `A`/`B` only.

| Field Name | Data Type | Constraints / Default | Description & Business Logic |
| :---- | :---- | :---- | :---- |
| **A** (`role_id`) | UUID | FK ➔ roles.id, On Delete CASCADE | Target role. |
| **B** (`permission_id`) | UUID | FK ➔ permissions.id, On Delete CASCADE | Permission capability linked to the role. |

##### **Why Tables 7–8 have no `assigned_by_id` / `assigned_at`**

Earlier revisions of this document specified both columns on both tables. **They were never implementable as written**, and the schema does not have them:

* A Prisma **implicit** m2m relation (`Role[]` ↔ `User[]`) produces a two-column join table. Adding a payload column requires converting to an **explicit** junction model — a `model UserRole { … }` with its own `@@id([userId, roleId])`, exactly the way [Table 4 `user_departments`](#table-4-user_departments-junction-table) is written. That conversion was made for `user_departments` because it genuinely needs `is_primary`; it was **not** made here.
* **The provenance is not lost — it moved.** "Who granted this role, and when" is recorded as an `audit_logs` row (Domain D) with `action = ROLE_ASSIGNED`, the actor in `user_id`, the target in `metadata`, and `created_at` as the timestamp. That is a *better* home for it: the audit trail is immutable and append-only, whereas a junction column is silently overwritten when a role is removed and re-granted, losing the earlier grant entirely.
* **Consequence to respect:** because the join row carries no timestamp, questions like *"show every role granted last Tuesday"* must be answered from `audit_logs`, never by querying the junction. Any endpoint that promises grant provenance reads Domain D.

**If a future requirement genuinely needs per-row payload here** (grant expiry, "temporary elevation until X"), convert to an explicit model at that point and add the columns then — do not add them back to this spec speculatively.

#### **Table 9: device_sessions**

*Manages active user sessions, rotating refresh tokens, and trusted 2FA devices.*

| Field Name | Data Type | Constraints / Default | Description & Business Logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | Primary Key, gen_random_uuid() | Unique session identifier. |
| **user_id** | UUID | NOT NULL, FK ➔ users.id, On Delete CASCADE, Indexed | User who owns this session. |
| **refresh_token_hash** | VARCHAR(64) | NOT NULL, UNIQUE, Indexed | **SHA-256 hex** of the opaque refresh token — deliberately not bcrypt (see §1.5). Rotated on every refresh. |
| **family_id** | UUID | NOT NULL, gen_random_uuid(), Indexed | Constant across every rotation in one login lineage. Revoking a stolen token revokes the whole family. |
| **rotated_at** | TIMESTAMPTZ | Nullable | Set when this token is exchanged for a successor. A non-NULL value marks the row *spent* — the row is retained (not deleted) so replay of the spent token is detectable. |
| **device_token_hash** | VARCHAR(64) | Nullable, UNIQUE | SHA-256 of the "remember this device" secret. Separate from refresh_token_hash because device trust must survive refresh rotations. |
| **trusted_until** | TIMESTAMPTZ | Nullable | When device trust lapses — independent of the session's own expires_at. |
| **device_name** | VARCHAR(100) | Nullable | Human-readable client (e.g., "Chrome on macOS"). |
| **ip_address** | VARCHAR(45) | NOT NULL | Client IP address at login (IPv4 or IPv6). |
| **user_agent** | TEXT | NOT NULL | Browser header string used for device fingerprinting. |
| **is_trusted** | BOOLEAN | NOT NULL, false | True if user checked "Remember this device" to bypass 2FA. Meaningful only while `trusted_until > NOW()`. |
| **expires_at** | TIMESTAMPTZ | NOT NULL, Indexed | Expiration of this refresh token. |
| **created_at** | TIMESTAMPTZ | NOT NULL, NOW() | Session establishment timestamp. |
| **updated_at** | TIMESTAMPTZ | NOT NULL, NOW() | Last active activity timestamp. |

* **Live-Session Predicate:** `rotated_at IS NULL AND expires_at > NOW()`. A row with `rotated_at` set is history, not an active session — session-listing endpoints must filter on it or the UI will show one "device" per refresh performed.
* **Indexes:** `(user_id)` for session listings, `(family_id)` for family-wide revocation, `(expires_at)` for the pruning job.
* **Retention:** Spent rows are pruned by a scheduled job only once `expires_at` has passed, since replay detection needs them until then.

#### **Table 10: two_factor_backup_codes**

| Field Name | Data Type | Constraints / Default | Description & Business Logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | Primary Key, gen_random_uuid() | Unique ID for this backup code. |
| **user_id** | UUID | NOT NULL, FK ➔ users.id, On Delete CASCADE | User who owns this backup code. |
| **code_hash** | VARCHAR(255) | NOT NULL | Secure SHA-256 hash of the backup code. |
| **is_used** | BOOLEAN | NOT NULL, false | Tracks if the code has been consumed for login. |
| **expires_at** | TIMESTAMPTZ | NOT NULL | Default 30 days after creation. |
| **created_at** | TIMESTAMPTZ | NOT NULL, NOW() | Timestamp of code generation. |

#### **Table 11: otps**

*Single-use numeric codes for email and phone ownership verification.*

| Field Name | Data Type | Constraints / Default | Description & Business Logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | Primary Key, gen_random_uuid() | Unique identifier for this OTP challenge. |
| **user_id** | UUID | NOT NULL, FK ➔ users.id, On Delete CASCADE | User the code was issued to. |
| **purpose** | ENUM | NOT NULL | Channel being verified: EMAIL_VERIFICATION, PHONE_VERIFICATION. |
| **target** | VARCHAR(255) | NOT NULL | The specific email address or phone number receiving the code. Binds the code to one destination so it cannot be replayed against a different address (see §1.9). |
| **code_hash** | VARCHAR(255) | NOT NULL | SHA-256 hash of the 6-digit code. The plaintext is never persisted. |
| **attempts_count** | INT | NOT NULL, Default: 0 | Failed verification attempts against this code. |
| **max_attempts** | INT | NOT NULL, Default: 5 | Brute-force ceiling. When attempts_count reaches this value the application sets is_used = true, burning the code. |
| **is_used** | BOOLEAN | NOT NULL, Default: false | True once consumed successfully **or** exhausted via max_attempts. |
| **expires_at** | TIMESTAMPTZ | NOT NULL, Indexed | Expiry (recommended 10 minutes for email, 5 for SMS). |
| **created_at** | TIMESTAMPTZ | NOT NULL, NOW() | Code generation timestamp. |
| **updated_at** | TIMESTAMPTZ | NOT NULL, NOW() | Last attempt/consumption timestamp. |

* **Validity Predicate:** A code is redeemable only when `is_used = false AND expires_at > NOW() AND attempts_count < max_attempts`.
* **Indexes:** `(user_id, purpose)` for "latest outstanding code" lookups; `(expires_at)` for the pruning job.
* **Request Throttling:** Re-issuing a code invalidates the user's prior outstanding codes for the same purpose. Resend requests are additionally rate-limited at the gateway (Redis) to stop SMS-pumping abuse.
* **On Success:** EMAIL_VERIFICATION sets users.is_email_verified = true; PHONE_VERIFICATION writes target into users.phone_number and sets is_phone_verified = true.

#### **Table 12: password_reset_tokens**

*High-entropy single-use tokens backing the forgot-password link flow.*

| Field Name | Data Type | Constraints / Default | Description & Business Logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | Primary Key, gen_random_uuid() | Unique identifier for this reset request. |
| **user_id** | UUID | NOT NULL, FK ➔ users.id, On Delete CASCADE, Indexed | User who requested the password reset. |
| **token_hash** | VARCHAR(64) | NOT NULL, UNIQUE, Indexed | **SHA-256 hex** of the opaque token embedded in the emailed reset URL, for the same by-value-lookup reason as device_sessions.refresh_token_hash (§1.5). The raw token exists only in the email. |
| **ip_address** | VARCHAR(45) | Nullable | IP address the reset request originated from (IPv4 or IPv6). |
| **user_agent** | TEXT | Nullable | Client browser/device that requested the reset. |
| **is_used** | BOOLEAN | NOT NULL, Default: false | True once the token has been redeemed. |
| **expires_at** | TIMESTAMPTZ | NOT NULL, Indexed | Expiry (recommended 1 hour). |
| **created_at** | TIMESTAMPTZ | NOT NULL, NOW() | Request timestamp. |
| **updated_at** | TIMESTAMPTZ | NOT NULL, NOW() | Redemption timestamp. |

* **Validity Predicate:** `is_used = false AND expires_at > NOW()`. No attempt counter is needed — the token is long and random, so guessing is infeasible.
* **No Enumeration:** `POST /auth/password/forgot` always responds 202 whether or not the email exists; a row is only created when it does.
* **On Success:** password_hash is replaced, is_used is set, every other outstanding token for that user is invalidated, and **all device_sessions rows for the user are revoked** so a stolen session cannot survive the reset.
* **Provenance Disclosure:** ip_address and user_agent are rendered in the reset email so an unexpected request is recognizable as an attack, and are copied into the PASSWORD_RESET_REQUESTED audit_logs entry.

#### **Table 28: user_invitations**

*Tokenized offers of tenant membership with roles and departments pre-assigned.*

Conceptually a sibling of Tables 11–12 (§1.9) — a hashed, expiring, single-use secret delivered out-of-band. It differs in one decisive way: the recipient **has no account yet**, so the row is keyed to an `organization_id` and an address rather than to a `user_id`.

| Field Name | Data Type | Constraints / Default | Description & Business Logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | Primary Key, gen_random_uuid() | Unique identifier for this invitation. |
| **organization_id** | UUID | NOT NULL, FK ➔ organizations.id, On Delete CASCADE, Indexed | Tenant the invitation grants membership in. |
| **email** | VARCHAR(255) | NOT NULL | Address the invitation was sent to, stored lower-cased. Becomes `users.email` on acceptance. |
| **token_hash** | VARCHAR(64) | NOT NULL, UNIQUE, Indexed | **SHA-256 hex** of a 32-byte URL-safe token embedded in the emailed link. Same by-value-lookup rationale as `password_reset_tokens.token_hash` (§1.9); the raw token exists only in the email. |
| **status** | ENUM | NOT NULL, Default: 'PENDING' | `PENDING`, `ACCEPTED`, `REVOKED`, `EXPIRED`. A deliberate departure from the `is_used` boolean of Tables 11–12: an invitation has four terminal states an admin must be able to tell apart, and "never accepted" is a real onboarding-funnel metric. |
| **role_ids** | UUID[] | NOT NULL, Default: '{}' | Roles to grant on acceptance. Validated at redemption, not by FK — see the Proposal vs. Fact note below. |
| **department_ids** | UUID[] | NOT NULL, Default: '{}' | Departments to join on acceptance. |
| **primary_department_id** | UUID | Nullable | Which membership receives `is_primary = true`, satisfying the partial unique index on user_departments (Table 4). Must appear in department_ids. |
| **invited_by_id** | UUID | Nullable, FK ➔ users.id, On Delete SET NULL | Admin who issued the invitation. Rendered in the public preview ("Jane Doe invited you to Acme Corp") — the single strongest signal that the email is not phishing. NULL when issued by a Super Admin during tenant onboarding. |
| **batch_id** | UUID | Nullable, Indexed | Groups invitations created by one bulk call, so the UI can report "Import 2026-07-30: 47 sent, 31 accepted, 16 pending". |
| **resent_count** | INT | NOT NULL, Default: 0 | Number of times the invitation has been re-sent. Drives rate limiting and is surfaced in the admin list. |
| **last_sent_at** | TIMESTAMPTZ | NOT NULL, NOW() | Timestamp of the most recent send, for resend throttling. |
| **accepted_user_id** | UUID | Nullable, FK ➔ users.id, On Delete SET NULL | The account created by redemption. Closes the audit loop from invitation to user. |
| **accepted_at** | TIMESTAMPTZ | Nullable | Redemption timestamp. |
| **revoked_by_id** | UUID | Nullable, FK ➔ users.id, On Delete SET NULL | Admin who revoked a pending invitation. |
| **revoked_at** | TIMESTAMPTZ | Nullable | Revocation timestamp. |
| **expires_at** | TIMESTAMPTZ | NOT NULL, Indexed | Expiry (recommended 7 days). Short by design — an outstanding invitation reserves a seat. |
| **created_at** | TIMESTAMPTZ | NOT NULL, NOW() | Issue timestamp. |
| **updated_at** | TIMESTAMPTZ | NOT NULL, NOW() | Last state change. |

* **Validity Predicate:** `status = 'PENDING' AND expires_at > NOW()`.
* **One Outstanding Invitation Per Address Per Tenant:** partial unique index, mirroring the `users` pattern in §1.10 — two admins must not be able to invite the same person twice.

  ```sql
  CREATE UNIQUE INDEX user_invitations_pending_key
    ON user_invitations (organization_id, email) WHERE status = 'PENDING';
  ```

* **Indexes:** `(organization_id, status)` for the admin list view; `(token_hash)` for redemption; `(expires_at)` for the pruning job; `(batch_id)` for bulk-import reporting.
* **Proposal vs. Fact (why arrays, not junction tables):** `user_roles` and `user_departments` record what *is* true and need referential integrity. An invitation records what an admin *intends* to grant — a proposal with a seven-day life. Redemption must re-validate regardless (a role may have been deleted, a department soft-deleted, the tenant moved to FROZEN), so FK enforcement buys little against the cost of two more junction tables. Any id that no longer resolves at acceptance is skipped and reported, never fatal.
* **Seat Reservation:** a PENDING invitation counts against `organizations.max_agent_seats` alongside active agents (§1.8). Expiry is what releases the reservation, which is why the window is short.
* **Resend Rotates the Token:** re-sending issues a fresh token and invalidates the previous one — the same rotation discipline as `password_reset_tokens`. `resent_count` increments and `last_sent_at` is stamped; the gateway rate-limits by invitation id in Redis so the endpoint cannot be turned into an email bomb.
* **Pruning Transitions, Never Deletes:** the scheduled job that prunes `otps` and `password_reset_tokens` instead flips expired invitations `PENDING → EXPIRED`. The rows are retained because "16 of 47 invitees never accepted" is an onboarding metric, not garbage. Rows are removed only with their tenant, via CASCADE.
* **On Success:** a `users` row is created with `is_email_verified = true` — delivery to the address is the same proof of ownership an `otps` challenge provides (§1.9), so requiring a second verification would be theatre. `user_roles` and `user_departments` are written from the validated arrays, `accepted_user_id` is linked, and the token is spent.

### **Domain B: Support Tickets & Real-Time Messaging**

#### **Table 13: tickets**

*Core entity tracking customer or employee support inquiries.*

> Lives in `postgres_ticket`. Every "FK ➔ users.id" / "FK ➔ departments.id" below (and on Tables 14, 26) is logical, not a database constraint — see §1.13.

| Field Name | Data Type | Constraints / Default | Description & Business Logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | Primary Key, gen_random_uuid() | Internal unique database key. |
| **ticket_number** | BIGINT | NOT NULL, UNIQUE, Autoincrement | Human-friendly ticket number (e.g., #1042). |
| **organization_id** | UUID | NOT NULL, FK ➔ organizations.id | Tenant isolation key. |
| **author_id** | UUID | NOT NULL, FK ➔ users.id | End-user who created the ticket. |
| **source** | ENUM | NOT NULL, Default: 'WEB' | Ticket origin channel: `WEB` (form submission), `CHAT` (escalated from chat), `EMAIL` (inbound email), `API` (third-party integration). Enables deflection analytics by channel. |
| **title** | VARCHAR(255) | NOT NULL | Brief subject line summarizing the issue. |
| **description** | TEXT | NOT NULL | Detailed problem statement supplied by the user. |
| **status** | ENUM | NOT NULL, Default: 'NEW' | Options: NEW, OPEN, PENDING_AGENT, ESCALATED, RESOLVED, CLOSED. |
| **priority** | ENUM | NOT NULL, Default: 'MEDIUM' | Urgency rating: LOW, MEDIUM, HIGH, URGENT. |
| **current_assignee_id** | UUID | Nullable, FK ➔ users.id, Indexed | Currently assigned agent (denormalized from latest `ticket_assignments` row where `is_current=true` for fast lookup). |
| **current_department_id** | UUID | Nullable, FK ➔ departments.id, Indexed | Department of current assignee (denormalized from latest `ticket_assignments` for fast department-based filtering). This is the effective "category" of the ticket. |
| **escalated_at** | TIMESTAMPTZ | Nullable | Timestamp when issue moved from AI (Tier 1) to Human Agent (Tier 2). |
| **resolved_at** | TIMESTAMPTZ | Nullable | Timestamp when issue was marked resolved. |
| **created_at** | TIMESTAMPTZ | NOT NULL, NOW(), Indexed | Ticket submission timestamp. |
| **updated_at** | TIMESTAMPTZ | NOT NULL, NOW() | Last message or status modification timestamp. |
| **deleted_at** | TIMESTAMPTZ | Nullable | Soft-delete timestamp. |
| **deleted_by_id** | UUID | Nullable, FK ➔ users.id | User or Agent who soft-deleted this ticket. |

#### **Table 14: ticket_messages**

*Unified log storing all messages (User, AI Assistant, Human Agents).*

| Field Name | Data Type | Constraints / Default | Description & Business Logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | Primary Key, gen_random_uuid() | Unique message ID. |
| **ticket_id** | UUID | NOT NULL, FK ➔ tickets.id, Indexed | Foreign key linking message to parent ticket thread. |
| **sender_id** | UUID | Nullable, FK ➔ users.id | Author of message. Null if sent automatically by System/AI. |
| **content** | TEXT | NOT NULL | Text body of the message (Markdown supported). |
| **is_ai_generated** | BOOLEAN | NOT NULL, Default: false | True if generated by the RAG service / LLM. |
| **is_internal_note** | BOOLEAN | NOT NULL, Default: false | True if message is a private note visible ONLY to agents. |
| **model_name** | VARCHAR(100) | Nullable | Explicit model string if AI-generated (e.g., gemini-1.5-pro). |
| **prompt_tokens** | INT | Nullable | Input tokens reported by the AI provider. Populated only when is_ai_generated = true. |
| **completion_tokens** | INT | Nullable | Output tokens reported by the AI provider. Populated only when is_ai_generated = true. |
| **edited_at** | TIMESTAMPTZ | Nullable | Set when the sender edits their own message inside the edit window. Lets the thread show "edited" with no separate revision table. |
| **redacted_at** | TIMESTAMPTZ | Nullable | Set when a message is redacted. The row is **not deleted** — `content` is replaced with a fixed placeholder and the row keeps its position in the timeline, the same choice `notifications` makes with `archived_at` over `deleted_at` (§1.12). |
| **redacted_by_id** | UUID | Nullable | Who redacted it (an agent via `ticket.message.moderate`, or the sender within the edit window). Logical reference only — see §1.13. |
| **created_at** | TIMESTAMPTZ | NOT NULL, NOW(), Indexed | Message dispatch timestamp. |

* **Token Metering:** The RAG worker records the exact prompt/completion counts returned by the provider on every generated message. Billing sums these per tenant since organizations.billing_cycle_start to enforce organizations.monthly_ai_token_budget.
* **Edit & Redaction:** editing is time-boxed for the sender's own messages; agents may edit internal notes past the window via `ticket.message.moderate`. Redaction is content replacement, not row deletion, for the identical reason soft-delete exists elsewhere — something else may already reference this row's position in the thread.

#### **Table 15: message_attachments**

*Files uploaded inside ticket chat threads (e.g., error screenshots, logs).*

| Field Name | Data Type | Constraints / Default | Description & Business Logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | Primary Key, gen_random_uuid() | Unique attachment identifier. |
| **message_id** | UUID | NOT NULL, FK ➔ ticket_messages.id | Parent chat message containing this file. |
| **file_name** | VARCHAR(255) | NOT NULL | Original filename uploaded by user (e.g., screenshot.png). |
| **file_url** | TEXT | NOT NULL | An internal Firebase Storage object path, same discipline as `users.avatar_url` — see [ADR 0024](./decisions/0024-one-upload-mechanism.md). Not a URL despite the name; resolved to a signed URL only at the moment `GET /attachments/:id/download` (or a message-thread fetch) actually needs one. |
| **file_size_bytes** | BIGINT | NOT NULL | File size in bytes. |
| **mime_type** | VARCHAR(100) | NOT NULL | Internet media type (e.g., image/png, application/pdf). |
| **created_at** | TIMESTAMPTZ | NOT NULL, NOW() | Upload timestamp. |

#### **Table 16: ai_summaries**

*Stores AI Co-pilot auto-summaries generated when tickets escalate to human agents.*

| Field Name | Data Type | Constraints / Default | Description & Business Logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | Primary Key, gen_random_uuid() | Unique summary identifier. |
| **ticket_id** | UUID | NOT NULL, UNIQUE, FK ➔ tickets.id | One-to-one relationship with active escalated ticket. |
| **summary_text** | TEXT | NOT NULL | Concise bullet-point summary of previous user chat thread. |
| **suggested_action** | TEXT | NOT NULL | Recommended resolution steps for the human agent. |
| **confidence_score** | FLOAT | NOT NULL | AI confidence metric (0.0 to 1.0). |
| **model_name** | VARCHAR(100) | NOT NULL | AI Model invoked (e.g., gpt-4o). |
| **created_at** | TIMESTAMPTZ | NOT NULL, NOW() | Summary generation timestamp. |
| **updated_at** | TIMESTAMPTZ | NOT NULL, NOW() | Last (re-)generation timestamp. Required because `ticket_id` is `UNIQUE`: re-generating is an **upsert**, not an append — a ticket has one current summary, and the prior one is not history worth keeping since it summarized a thread that has since moved on. |

#### **Table 26: ticket_assignments**

*Assignment lifecycle tracking: who held each ticket, when, which department, and why they were reassigned.*

| Field Name | Data Type | Constraints / Default | Description & Business Logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | Primary Key, gen_random_uuid() | Unique assignment record ID. |
| **ticket_id** | UUID | NOT NULL, FK ➔ tickets.id, Indexed | Ticket being assigned. |
| **assigned_to_id** | UUID | NOT NULL, FK ➔ users.id, Indexed | Agent receiving the assignment. |
| **assigned_by_id** | UUID | Nullable, FK ➔ users.id, ON DELETE SET NULL | User who made the assignment (system/automation if NULL). |
| **department_id** | UUID | NOT NULL, FK ➔ departments.id | Department the assigned agent belongs to. Captures which team owned the ticket at this stage (the "category" in ticket taxonomy). |
| **assigned_at** | TIMESTAMPTZ | NOT NULL, NOW() | When the assignment was made. |
| **unassigned_at** | TIMESTAMPTZ | Nullable | When the agent stopped owning the ticket (assignment ended). NULL = currently assigned. |
| **reason** | ENUM | NOT NULL, Default `INITIAL` | Why the assignment was made: `INITIAL` (first assignment from AI escalation) \| `ESCALATION` (moved up the expertise chain) \| `SKILL_MISMATCH` (wrong team, needs handoff) \| `WORKLOAD_BALANCE` (deliberate distribution) \| `REASSIGNMENT` (agent request or admin action). |
| **is_current** | BOOLEAN | NOT NULL, Default false | Flag for the active assignment (always exactly one `is_current=true` per ticket, except before first assignment). Optimizes lookup of current assignee. |
| **created_at** | TIMESTAMPTZ | NOT NULL, NOW() | Record creation timestamp. |

* **Indexes:** `(ticket_id, is_current=true)` (current assignee lookup); `(assigned_to_id, created_at DESC)` (agent workload history).
* **Unique partial index:** `UNIQUE (ticket_id) WHERE is_current = true` — exactly one active assignment per ticket.
* **Business logic:** When a ticket is escalated or assigned, a row is inserted with `is_current=true`. When reassigned, the prior row's `unassigned_at` is set and `is_current` flipped to false, then a new row inserted with the new assignee. This gives a complete timeline of who handled the ticket and why it changed hands.
* **Denormalization:** `tickets.current_assignee_id` and `tickets.current_department_id` cache the latest `assigned_to_id` and `department_id` for fast query access without joins.

### **Domain C: Knowledge Base, Ingestion & RAG Metadata**

#### **Table 17: documents**

*Stores top-level enterprise documentation uploaded for AI knowledge indexing.*

| Field Name | Data Type | Constraints / Default | Description & Business Logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | Primary Key, gen_random_uuid() | Unique document identifier. |
| **organization_id** | UUID | NOT NULL, FK ➔ organizations.id | Tenant isolation boundary. |
| **created_by_id** | UUID | NOT NULL, FK ➔ users.id | Knowledge Manager or Admin who uploaded the document. |
| **title** | VARCHAR(255) | NOT NULL | Document title (e.g., "2026 Employee Handbook"). |
| **file_url** | TEXT | NOT NULL | An internal Firebase Storage object path (`documents` purpose — reserved, not yet wired), same discipline as `users.avatar_url` and `message_attachments.file_url`. Not a URL despite the name. |
| **file_type** | VARCHAR(50) | NOT NULL | File extension (pdf, docx, md, txt). |
| **file_size_bytes** | BIGINT | NOT NULL | File size in bytes. |
| **is_organization_wide** | BOOLEAN | NOT NULL, Default: true | If true, document is accessible across all departments in the org. |
| **status** | ENUM | NOT NULL, Default: 'PENDING' | Pipeline status: PENDING, PROCESSING, INDEXED, FAILED. |
| **created_at** | TIMESTAMPTZ | NOT NULL, NOW() | Upload timestamp. |
| **updated_at** | TIMESTAMPTZ | NOT NULL, NOW() | Metadata update timestamp. |
| **deleted_at** | TIMESTAMPTZ | Nullable | Soft-delete timestamp (removes doc from active RAG context). |
| **deleted_by_id** | UUID | Nullable, FK ➔ users.id | Knowledge Manager or Admin who soft-deleted this document. |

#### **Table 18: department_documents (Junction Table)**

*Enables Many-to-Many scoping between documents and departments.*

| Field Name | Data Type | Constraints / Default | Description & Business Logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | Primary Key, gen_random_uuid() | Primary Key. |
| **document_id** | UUID | NOT NULL, FK ➔ documents.id, On Delete CASCADE | Referenced document. |
| **department_id** | UUID | NOT NULL, FK ➔ departments.id, On Delete CASCADE | Department granted access to this document. |
| **created_at** | TIMESTAMPTZ | NOT NULL, NOW() | Link creation timestamp. |

* **Unique Constraint:** (document_id, department_id) prevents duplicate link records.

#### **Table 19: document_chunks**

*Relational text snippets and citation metadata corresponding to vector DB points.*

| Field Name | Data Type | Constraints / Default | Description & Business Logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | Primary Key, gen_random_uuid() | Internal database primary key. |
| **document_id** | UUID | NOT NULL, FK ➔ documents.id | Parent document reference. |
| **chunk_index** | INT | NOT NULL | Sequential chunk order in original file (0, 1, 2, 3...). |
| **content_text** | TEXT | NOT NULL | Full raw text extracted for this chunk. |
| **page_number** | INT | Nullable | Source page number (for PDF citation highlighting). |
| **token_count** | INT | NOT NULL | Total tokens in chunk (used for prompt budget calculation). |
| **vector_point_id** | UUID | NOT NULL, UNIQUE, Indexed | Exact Point ID corresponding to vector in Qdrant Vector DB. |
| **organization_id** | UUID | NOT NULL, Indexed | **Denormalized from `documents`.** Tenant isolation for the lexical retrieval arm — see below. |
| **is_organization_wide** | BOOLEAN | NOT NULL, Default: true | **Denormalized from `documents`.** Department-scoping clause 1. |
| **department_ids** | UUID[] | NOT NULL, Default: '{}' | **Denormalized from `department_documents`.** Department-scoping clause 2. GIN-indexed for `&&` (array overlap). |
| **is_deleted** | BOOLEAN | NOT NULL, Default: false | **Denormalized from `documents.deleted_at IS NOT NULL`.** Soft-deleted documents leave retrieval immediately without a join. |
| **retrieval_count** | INT | NOT NULL, Default 0 | Times this chunk has been retrieved into a generation's context. Maintained by the daily projection job, **not** written on the hot path. |
| **last_retrieved_at** | TIMESTAMPTZ | Nullable | — |
| **citation_count** | INT | NOT NULL, Default 0 | Times this chunk was actually *cited* in an answer, which is a strictly smaller number than `retrieval_count`. The gap between the two is the interesting signal — see Table 27. |
| **last_cited_at** | TIMESTAMPTZ | Nullable | — |
| **created_at** | TIMESTAMPTZ | NOT NULL, NOW() | Ingestion timestamp. |

* **Why four columns are denormalized here.** Hybrid retrieval runs two arms over two stores, and **both must enforce the same four-clause boundary** (§1.2 + soft-delete). The semantic arm reads a Qdrant payload that already carries all four, denormalized deliberately — a filter needing a Postgres round trip per ANN candidate would defeat the index. Without these columns the lexical arm would express the *same rule* as a `document_chunks → documents` join plus an `EXISTS` against `department_documents`, which means the security boundary is **two different queries over different tables** that only a test can prove equivalent. With them, both arms compare the same four fields, and the drift test compares like with like. The same denormalization argument that was accepted for Qdrant applies here for the same reason.
* **Consequence, stated plainly:** `PUT /documents/:id/departments`, `PATCH /documents/:id` (`is_organization_wide`) and `DELETE /documents/:id` now fan out to **both** stores — the identical fan-out already accepted for Qdrant, in the same shape. The ordering rule for that fan-out is in [ADR 0036](./decisions/0036-scope-fanout-order-is-asymmetric.md), and it is not symmetric: restrictions apply to the retrievable stores first.
* **Index:** the FTS index is **composite** — `(organization_id, to_tsvector('simple', content_text))` — so tenant filtering happens *before* text matching. A GIN index on the `tsvector` alone would match text across every tenant's chunks and filter afterwards: not a leak, but a query that slows down precisely as the corpus grows.
* **The usage counters are a projection, not a hot-path write.** They exist because `ai_generations` is retention-rolled (Table 29) and the rollups do not carry chunk ids — so a flag defined as "never retrieved in N months" would silently stop working the moment rollups ship. The daily job projects the ledger's arrays into these counters *before* the retention job trims the rows it read.

#### **Table 20: ingestion_jobs**

*BullMQ background processing job states for asynchronous PDF chunking/embedding.*

| Field Name | Data Type | Constraints / Default | Description & Business Logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | Primary Key, gen_random_uuid() | Primary Key. |
| **document_id** | UUID | NOT NULL, FK ➔ documents.id | Target document being processed. |
| **bullmq_job_id** | VARCHAR(100) | NOT NULL, Indexed | Task ID tracked inside Redis / BullMQ queue. |
| **status** | ENUM | NOT NULL, Default: 'QUEUED' | Steps: QUEUED, PARSING, CHUNKING, EMBEDDING, COMPLETED, FAILED. |
| **error_log** | TEXT | Nullable | Detailed stack trace if parsing or vector embedding failed. |
| **processed_at** | TIMESTAMPTZ | Nullable | Completion timestamp. |
| **created_at** | TIMESTAMPTZ | NOT NULL, NOW() | Job registration timestamp. |

#### **Table 27: document_flags**

*Quality signals and conflict detection across the knowledge base.*

| Field Name | Data Type | Constraints / Default | Description & Business Logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | Primary Key, gen_random_uuid() | Flag ID. |
| **organization_id** | UUID | NOT NULL, FK ➔ organizations.id, Indexed | Tenant isolation. |
| **document_id** | UUID | NOT NULL, FK ➔ documents.id, ON DELETE CASCADE | Flagged document. |
| **related_document_id** | UUID | Nullable, FK ➔ documents.id | The conflicting or superseded counterpart (if flag_type = CONFLICTING). |
| **related_chunk_id** | UUID | Nullable, FK ➔ document_chunks.id | Specific chunk within `document_id` that is problematic. |
| **flag_type** | ENUM | NOT NULL, Indexed | Classification: `OUTDATED` (document age exceeds TTL or contains expired year references) \| `UNRETRIEVED` (indexed but **never once retrieved** into any generation's context in N months — dead weight) \| `UNCITED` (**retrieved repeatedly but never cited** — it keeps winning a context slot and never earning it, which is worse than being ignored: it displaces documents that would have answered) \| `LOW_CONFIDENCE` (cited rarely relative to retrieval, or citations downvoted) \| `NEGATIVE_FEEDBACK` (consistent thumbs-down or `ai_response_feedbacks.citation_accurate = false`) \| `CONFLICTING` (contradicts `related_document_id` on a key topic). |
| **severity** | ENUM | NOT NULL, Default `INFO` | `INFO \| WARNING \| CRITICAL`. Drives whether it appears in Knowledge Manager dashboards. |
| **detail** | TEXT | NOT NULL | Human-readable finding (e.g., "Conflicts with Handbook §4.2 on PTO carryover: this doc says 5 days, handbook says 10 days"). |
| **confidence_score** | FLOAT | Nullable | LLM confidence (0.0–1.0) for CONFLICTING flags. Null for heuristic flags. |
| **detected_at** | TIMESTAMPTZ | NOT NULL, NOW() | When the flag was auto-detected by a scheduled job or on-demand analysis. |
| **resolved_at** | TIMESTAMPTZ | Nullable | Timestamp when Knowledge Manager actioned the flag. |
| **resolved_by_id** | UUID | Nullable, FK ➔ users.id, ON DELETE SET NULL | User who resolved the flag. |
| **resolution** | ENUM | Nullable | Action taken: `FIXED` (document was updated), `DISMISSED` (finding is invalid, will not resurface), `DOCUMENT_REPLACED` (the document was removed and a newer version uploaded). |
| **created_at** | TIMESTAMPTZ | NOT NULL, NOW() | Flag creation. |

* **Business logic:** Heuristic flags (OUTDATED, UNRETRIEVED, UNCITED, LOW_CONFIDENCE, NEGATIVE_FEEDBACK) are generated by a scheduled job that runs daily over `documents`, `document_chunks`, and `ai_response_feedbacks`. CONFLICTING flags require an expensive LLM run and are generated on-demand or nightly over high-risk document pairs (detected via embedding similarity). Once resolved, a flag is never re-flagged with the same (type, resolution) pair in the same month — prevents alert fatigue.
* **`UNRETRIEVED` and `UNCITED` are different findings and were previously conflated.** Both read `document_chunks.retrieval_count` / `citation_count` (Table 19), **not** `ai_generations` directly — the ledger is retention-rolled and its per-chunk arrays do not survive, so a flag defined against it would quietly stop firing. `UNRETRIEVED` is `retrieval_count = 0`: nobody's question ever came near this document, so it is either mis-titled or genuinely unwanted. `UNCITED` is `retrieval_count > N AND citation_count = 0`: the retriever keeps selecting it and the generator keeps declining to use it, so it is consuming a context slot that a useful document would otherwise hold. The second is the one worth acting on first, and it is invisible to a flag that only knows about retrieval.

### **Domain D: Analytics, Feedback & Compliance Audit**

#### **Table 21: ai_response_feedbacks**

*User ratings on AI-generated answers for quality monitoring and RAG refinement.*

> Owned by `ticket-service` (service ownership map), physically in `postgres_ticket` alongside Domain B — **not** `postgres_auth`. "FK ➔ users.id" below is logical; see §1.13. Also see §1.13 for Table 22.

| Field Name | Data Type | Constraints / Default | Description & Business Logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | Primary Key, gen_random_uuid() | Feedback primary key. |
| **ticket_message_id** | UUID | NOT NULL, Indexed — **no FK, deliberately** | The specific AI answer being evaluated. Both tables live in `postgres_ticket`, so a real FK is *possible* here, and was deliberately not added: a `CASCADE` would silently delete the feedback signal the moment the message it rated is redacted (§Table 14), and "a bad answer was reported" is exactly the fact worth surviving that. |
| **user_id** | UUID | NOT NULL | User who provided rating. Logical reference only — `users` is in `postgres_auth` (§1.13). |
| **organization_id** | UUID | NOT NULL, Indexed | Denormalized so the tenant-scoped feedback list (`GET /feedback`) doesn't need to join back through `ticket_messages` → `tickets` on every row — same reasoning as `tickets.current_assignee_id`. |
| **rating** | INT | NOT NULL | **1** for Thumbs Up, **-1** for Thumbs Down. Constrained to `{1, -1}` at the application layer and by an optional seed-applied `CHECK` (Prisma expresses neither, §7.3 of development-conventions.md). |
| **feedback_text** | TEXT | Nullable | Optional text explanation from user if answer was bad. |
| **citation_accurate** | BOOLEAN | Nullable | User verification if source citations were accurate. |
| **created_at** | TIMESTAMPTZ | NOT NULL, NOW() | Feedback submission timestamp. |
| **updated_at** | TIMESTAMPTZ | NOT NULL, NOW() | Last change timestamp — a user may revise a 👍 to a 👎, which is why this row is an upsert (see below), not append-only. |

* **Unique constraint:** `(ticket_message_id, user_id)` — one feedback row per user per answer. Submitting again **updates** the existing row rather than inserting a second, so a change of mind doesn't double-count in every quality metric derived from this table.

#### **Table 22: audit_logs**

*Immutable security trail for administrative compliance.*

| Field Name | Data Type | Constraints / Default | Description & Business Logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | Primary Key, gen_random_uuid() | Audit log primary key. |
| **organization_id** | UUID | Nullable, Indexed | Tenant boundary. Logical reference only (§1.13). NULL for platform-level actions taken by a Super Admin (e.g., freezing a delinquent tenant, changing platform configuration), which belong to no single customer — the consumer must never coerce this to the actor's own tenant. |
| **user_id** | UUID | Nullable, Indexed | Actor who performed the action. Logical reference only (§1.13). NULL for system/cron actors, which have no user row acting for them. |
| **action** | VARCHAR(100) | NOT NULL, Indexed | Event name, `SCREAMING_SNAKE` (e.g., `TICKET_ASSIGNED`, `ROLE_UPDATED`, `PLATFORM_ORGANIZATION_STATUS_CHANGED`). Backed by the `AuditAction` enum in `@synapsedesk/common`, not a free string — a typo becomes a compile error rather than a row that matches none of its siblings. |
| **resource_type** | VARCHAR(50) | Nullable, Indexed (with action) | What the event happened **to** — `USER`, `DEPARTMENT`, `ROLE`, `ORGANIZATION`, and so on, one member per resource type that publishes events (`AuditResourceType` enum). Kept separate from `action` and from `user_id` (the actor) on purpose: collapsing actor and target is what makes a trail useless in exactly the incident it exists for. |
| **resource_id** | UUID | Nullable, Indexed | The specific instance the action happened to. Logical reference only (§1.13) — its owning table depends on `resource_type` and may not even be in this database. |
| **ip_address** | VARCHAR(45) | Nullable | Client IP the action originated from, as observed by the gateway — never claimed by the caller. Nullable, not `NOT NULL` as an earlier revision of this table specified: a system/cron-triggered action has no request to observe an IP from. |
| **user_agent** | TEXT | Nullable | Client user-agent string, same observed-not-claimed discipline as `ip_address`. Added alongside it because `RecordAuditCommand.origin` (the actual NATS payload every publisher sends) is `{ ip, userAgent }` as one unit — splitting it into "one column now, add the other later" would have been the same mistake this table already avoided by defining the contract before the consumer. |
| **metadata** | JSONB | Nullable, Default `'{}'` | A **redacted** before/after diff. Never a password hash, a 2FA secret, or any `*_token_hash`/`code_hash` — the publisher whitelists what it records per resource type; a blacklist forgets the next secret someone adds to a model. |
| **created_at** | TIMESTAMPTZ | NOT NULL, NOW(), Indexed | Event occurrence timestamp, stamped by the **publisher's** clock, not the consumer's — a consumer restart must not backdate a backlog of events to the moment it caught up. |

* **Populated only by the NATS consumer in `ticket-service`, never by an RPC.** The proto for this module declares no `CreateAuditLog` message — a write path that doesn't exist in the contract cannot be added by accident, and the trail's value depends entirely on nobody being able to write to it directly.
* **At-most-once, by design.** NATS core (not JetStream) can drop a message; `AuditPublisher`'s own contract already treats that as acceptable (*"the trail can have holes when NATS is down"*) rather than a stronger guarantee every write in the system would have to pay for. Revisit only if a gap-free trail becomes a hard requirement — that is an upgrade to both the publisher and this consumer, not a fix to one.

#### **Table 29: ai_generations**

*Append-only ledger of **every** LLM and embedding call the system makes. The single source of truth for AI metering.*

> Added to close a **live metering hole**, not as an audit nicety. Before this table, `monthly_ai_token_budget` was defined as `SUM(ticket_messages.prompt_tokens + completion_tokens)` — but only a **chat answer** is ever persisted as a message. Drafts, summaries, classifications, greeting-intent checks, query reformulations and embeddings were all real spend that the quota gate structurally could not see. A tenant hammering `/ai/draft` could run indefinitely while reporting well under budget.

| Field Name | Data Type | Constraints / Default | Description & Business Logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | Primary Key, gen_random_uuid() | Ledger entry id. |
| **organization_id** | UUID | NOT NULL, Indexed | Tenant the spend belongs to. Logical reference only (§1.13). |
| **user_id** | UUID | Nullable | Who triggered it. NULL for system-initiated work — ingestion embeddings, scheduled jobs. |
| **ticket_id** | UUID | Nullable, Indexed | The ticket this call served, when there is one. NULL for ingestion and knowledge search. |
| **purpose** | VARCHAR(30) | NOT NULL, Indexed | `CHAT_ANSWER \| DRAFT \| SUMMARY \| CLASSIFY \| SUGGESTIONS \| GREETING_CLASSIFY \| REFORMULATION \| EMBEDDING`. String, not a Prisma enum (§7.3 of development-conventions.md); the values live in `@synapsedesk/common`. |
| **model_name** | VARCHAR(100) | NOT NULL | Exact model string invoked. Required for cost attribution — the same token count costs different money per model. |
| **prompt_tokens** | INT | NOT NULL, Default 0 | Input tokens reported by the provider. |
| **completion_tokens** | INT | NOT NULL, Default 0 | Output tokens. Zero for `EMBEDDING`, which has no completion. |
| **estimated_cost_micros** | BIGINT | NOT NULL, Default 0 | Cost in millionths of a currency unit, computed at write time from `model_name` × tokens. **Money, not tokens, is what a budget is actually protecting** — see §1.14. |
| **latency_ms** | INT | Nullable | Wall-clock duration. Feeds the p95 that tells you whether Tier 1 chat is still fast enough to deflect. |
| **status** | VARCHAR(20) | NOT NULL, Default `SUCCESS` | `SUCCESS \| FAILED \| CANCELLED`. A failed call still consumed prompt tokens and still costs money — recording only successes under-counts spend. |
| **content** | TEXT | Nullable | The generated text. Populated for `DRAFT` (needed to compute acceptance, below) and `SUMMARY`; NULL for `EMBEDDING` and the classification purposes, where it has no value. |
| **retrieved_chunk_ids** | UUID[] | NOT NULL, Default `'{}'` | The `document_chunks` this generation actually saw. Makes "why did it answer that?" answerable after the fact, and feeds knowledge-gap analysis when the array is empty. |
| **cited_chunk_ids** | UUID[] | NOT NULL, Default `'{}'` | The subset of the above the generation actually **cited**. Always a subset; the difference is what the model was given and chose not to use. Without this column, `UNCITED` (Table 27) is not computable and degrades into `UNRETRIEVED` under a misleading name. |
| **outcome** | VARCHAR(20) | Nullable | **Drafts only**, set later: `ACCEPTED \| EDITED \| DISCARDED`. NULL until the agent acts (or never, if they ignore it). |
| **resulting_message_id** | UUID | Nullable | The `ticket_messages` row this generation became, once sent. Links a draft to what the agent actually posted. |
| **created_at** | TIMESTAMPTZ | NOT NULL, NOW(), Indexed | — |

* **Indexes:** `(organization_id, created_at DESC)` — the metering sum and the analytics range scans; `(organization_id, purpose, created_at)` — spend broken down by surface; `(ticket_id)` — a ticket's AI history; **GIN on `retrieved_chunk_ids` and `cited_chunk_ids`** — the daily projection into Table 19's usage counters is an array-containment scan, which without GIN is a sequential scan of the largest table in the system.
* **`outcome = DISCARDED` is an absence, so something has to write it.** `ACCEPTED` and `EDITED` arrive from `generatedFromId` when the agent posts. `DISCARDED` never arrives, because ignoring a draft produces no request — so a scheduled sweep sets it: `purpose = 'DRAFT' AND outcome IS NULL AND resulting_message_id IS NULL AND created_at < NOW() - INTERVAL '24 hours'`. Without that job the rows stay `NULL` forever and acceptance rate divides by only the drafts that were used, which reports a number near 100% no matter how bad the drafts are.
* **"Verbatim" must be a normalized comparison.** `ACCEPTED` vs `EDITED` is decided by comparing the sent text against `content`; exact string equality classifies a trailing newline or an editor's whitespace normalization as an edit. Compare after Unicode NFC normalization, whitespace collapse and trim — otherwise the one metric justifying the co-pilot systematically understates itself.
* **The single source of truth for metering.** `ticket_messages.prompt_tokens`/`completion_tokens` remain, but are now a **denormalized convenience** for showing per-message cost in the UI. The quota gate sums *this* table, not a `UNION` across three — and this table is also the reconciliation target for the Redis counter that does the actual runtime check (§1.14).
* **Draft acceptance needs the outcome link, not just the content.** Storing the draft alone tells you how many were generated and nothing about whether the co-pilot helps. When the agent posts their reply the client sends `generatedFromId`; the service compares the sent text against `content` and classifies **ACCEPTED** (verbatim), **EDITED** (used but changed) or **DISCARDED** (never referenced). That is the one metric justifying the feature's cost, and `api-endpoints-plan §4`'s promised *"AI-draft acceptance rate"* is uncomputable without it.
* **Retention, and the one thing it must not break.** This table holds full generated text and grows on every AI call — `GREETING_CLASSIFY` rows especially will be high-volume and individually worthless. They are still **real spend and must be logged**; the volume is handled by retention, not by leaving another metering hole. Aggregate to daily per-(org, purpose, model) rollups after ~90 days and keep the rollups indefinitely; drop `content` first, since it is the bulk of the bytes and the least useful after the fact. **The rollups do not carry `retrieved_chunk_ids` / `cited_chunk_ids`**, so anything defined against those arrays dies when retention ships. That is why chunk usage is projected into `document_chunks` counters (Table 19) daily, and why the projection job must run **before** the retention job over the same window — the ordering is a correctness constraint, not a scheduling preference.
* **Relationship to `ai_summaries` (Table 16):** unchanged. That table holds the *current* summary for display, upserted, deliberately without history. This one is the append-only ledger underneath it — a re-generated summary overwrites there and appends here.

#### **Table 30: billing_events**

*Append-only record of every Stripe webhook the system has processed. Exists for idempotency and ordering, not for reporting.*

| Field Name | Data Type | Constraints / Default | Description & Business Logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | Primary Key, gen_random_uuid() | — |
| **stripe_event_id** | VARCHAR(255) | NOT NULL, **UNIQUE** | Stripe's `evt_…` id. The unique constraint **is** the idempotency mechanism: a redelivered webhook is a duplicate-key violation the handler catches and acknowledges, not a second entitlement write. Webhook delivery is at-least-once, so this is not defensive — it is the normal path. |
| **organization_id** | UUID | Nullable, Indexed | Resolved from `stripe_customer_id`. Nullable because an event can arrive for a customer that has no tenant yet (checkout completed before onboarding finished), and losing the event would be worse than storing it unattached. |
| **event_type** | VARCHAR(100) | NOT NULL, Indexed | `customer.subscription.updated`, `invoice.payment_failed`, … |
| **stripe_created_at** | TIMESTAMPTZ | NOT NULL | **Stripe's** `created`, not ours. This is the monotonic guard: an entitlement write is applied only when this is newer than the newest already applied for the subscription. Webhooks arrive out of order, and without this a delayed `subscription.updated` carrying the old plan lands after an upgrade and silently downgrades a paying tenant. |
| **payload** | JSONB | NOT NULL | The raw event. Kept because entitlement mapping bugs are only diagnosable against what Stripe actually sent, and a re-derivation needs the original. |
| **status** | VARCHAR(20) | NOT NULL, Default `PROCESSED` | `PROCESSED \| SKIPPED_STALE \| SKIPPED_DUPLICATE \| FAILED`. `SKIPPED_STALE` is the monotonic guard firing, and seeing it regularly is information, not noise. |
| **error_log** | TEXT | Nullable | Why a `FAILED` event failed, for replay. |
| **processed_at** | TIMESTAMPTZ | NOT NULL, NOW() | — |

* **Index:** `(organization_id, stripe_created_at DESC)` — the monotonic check reads the newest applied event per tenant on every webhook.
* **Signature verification happens before this table.** An event that fails Stripe's signature check is not recorded — it is rejected at the edge. This table holds events the system accepted as genuine, so a row here means "we believed this and acted on it," which is what makes it useful during an incident.
* **Not soft-deleted, never edited.** §1.6's audit-field policy does not apply: this is an event log, and the closest thing to it in the system is `audit_logs` (Table 22), which is also append-only for the same reason.

### **Domain E: Notifications & Messaging**

#### **Table 23: notifications**

*Per-recipient in-app notification feed with read/archive state and delivery tracking.*

| Field Name | Data Type | Constraints / Default | Description & Business Logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | Primary Key, gen_random_uuid() | Unique notification ID. |
| **organization_id** | UUID | NOT NULL, FK ➔ organizations.id, Indexed | Tenant isolation. |
| **recipient_id** | UUID | NOT NULL, FK ➔ users.id, Indexed | User receiving the notification. One row per recipient ensures efficient per-user queries. |
| **type** | VARCHAR(100) | NOT NULL, Indexed | Notification category (e.g., `ticket.assigned`, `ticket.status_changed`, `ticket.message_created`, `document.indexed`, `quota.exceeded`). Mirrors NATS event subjects for producer-driven routing. |
| **priority** | ENUM | NOT NULL, Default `NORMAL` | `LOW \| NORMAL \| HIGH \| CRITICAL`. Controls channel eligibility (CRITICAL bypasses quiet hours and digest batching) and digest coalescing. |
| **title** | VARCHAR(255) | NOT NULL | Rendered notification headline captured at write time. |
| **body** | TEXT | Nullable | Rendered notification details captured at write time. Enables safe display even if the referenced resource (e.g., ticket, document) is later deleted. |
| **data** | JSONB | NOT NULL, Default `'{}'` | Deep-link payload: `{ ticketId, ticketNumber, messageId, documentId, actorName }`. Drives SPA navigation. |
| **action_url** | TEXT | Nullable | Relative SPA path for deep-linking (e.g., `/tickets/1042`). |
| **actor_id** | UUID | Nullable, FK ➔ users.id | User who triggered the notification. NULL = system or AI-generated. Enables dismissing own actions. |
| **resource_type** | VARCHAR(50) | Nullable | Resource kind: `ticket \| document \| user \| organization`. |
| **resource_id** | UUID | Nullable, Indexed | Resource instance ID. Enables bulk-read when a resource is opened (e.g., all notifications for a ticket marked read). |
| **group_key** | VARCHAR(200) | Nullable, Indexed | Grouping identifier (e.g., `ticket:123:message`). Multiple notifications with the same key collapse into one row with an incremented `group_count`. |
| **group_count** | INT | NOT NULL, Default 1 | Number of events coalesced into this notification. Displayed as "12 new messages on #1042" rather than 12 separate rows. |
| **event_id** | VARCHAR(100) | Nullable | Producer-side idempotency key from NATS event metadata. Prevents duplicate notifications on NATS at-least-once redelivery. |
| **read_at** | TIMESTAMPTZ | Nullable | Timestamp when user marked read. NULL = unread. |
| **archived_at** | TIMESTAMPTZ | Nullable | Timestamp when user dismissed the notification. Hidden from default feed. |
| **expires_at** | TIMESTAMPTZ | Nullable, Indexed | Retention pruning cutoff; old notifications are removed by a scheduled cleanup job. |
| **created_at** | TIMESTAMPTZ | NOT NULL, NOW(), Indexed | Notification creation timestamp. |

* **Indexes:** `(recipient_id, created_at DESC) WHERE archived_at IS NULL` (feed query); `(recipient_id) WHERE read_at IS NULL AND archived_at IS NULL` (unread badge count); `UNIQUE (recipient_id, event_id) WHERE event_id IS NOT NULL` (NATS redelivery idempotency); `(recipient_id, group_key) WHERE read_at IS NULL AND group_key IS NOT NULL` (group collapse lookup).
* **Exception to RDM §1.6:** No `deleted_at` column — notifications are inherently ephemeral. `archived_at + expires_at` handle retention and user dismissals.

#### **Table 24: notification_deliveries**

*Channel-specific delivery attempts (email, SMS, in-app, webhook) with provider tracking.*

| Field Name | Data Type | Constraints / Default | Description & Business Logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | Primary Key, gen_random_uuid() | Delivery attempt ID. |
| **notification_id** | UUID | NOT NULL, FK ➔ notifications.id, ON DELETE CASCADE | Parent notification. Cascading delete cleans up delivery records. |
| **channel** | ENUM | NOT NULL | `IN_APP \| EMAIL \| SMS \| WEBHOOK`. Transport mechanism. |
| **status** | ENUM | NOT NULL, Default `PENDING` | Delivery state: `PENDING \| SENT \| DELIVERED \| FAILED \| SKIPPED \| BOUNCED`. Distinct from notification.read_at; sent ≠ read. |
| **skip_reason** | VARCHAR(100) | Nullable | Why delivery was skipped if status = SKIPPED (e.g., `user_preference`, `quiet_hours`, `unverified_address`, `already_seen_in_app`, `rate_limited`). Auditable alternative to silent drops. |
| **target** | VARCHAR(255) | Nullable | Snapshot of recipient's email/phone address at send time (same pattern as `otps.target`). Preserved if the user later changes their contact info. |
| **provider_message_id** | VARCHAR(255) | Nullable, Indexed | The delivery provider's own id — an SMTP `Message-ID` (nodemailer) or a Twilio SID, matching what `notification-service` actually uses. Correlates a provider delivery webhook back to this row. |
| **attempts** | INT | NOT NULL, Default 0 | Retry counter. Incremented on each retry attempt. |
| **error_log** | TEXT | Nullable | Human-readable last error. Same convention as `ingestion_jobs.error_log`. |
| **bullmq_job_id** | VARCHAR(100) | Nullable | Background job reference for retry management via BullMQ. |
| **sent_at** | TIMESTAMPTZ | Nullable | Timestamp when delivery was submitted to provider. |
| **delivered_at** | TIMESTAMPTZ | Nullable | Timestamp when provider confirmed successful delivery (from webhook). |
| **failed_at** | TIMESTAMPTZ | Nullable | Timestamp when delivery was abandoned after max retries. |
| **created_at** | TIMESTAMPTZ | NOT NULL, NOW() | Delivery attempt creation timestamp. |

* **Unique constraint:** `(notification_id, channel)` — one delivery per notification per channel, upserted if a retry is needed.

#### **Table 25: notification_preferences**

*User opt-in/opt-out and batching settings per notification type and delivery channel.*

| Field Name | Data Type | Constraints / Default | Description & Business Logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | Primary Key, gen_random_uuid() | Preference record ID. |
| **user_id** | UUID | NOT NULL, FK ➔ users.id, ON DELETE CASCADE | User whose preference this is. |
| **organization_id** | UUID | NOT NULL, FK ➔ organizations.id, Indexed | Tenant denormalization; enables tenant-scoped preference queries. |
| **type** | VARCHAR(100) | NOT NULL, Indexed | Notification type (e.g., `ticket.assigned`, `document.indexed`) or `'*'` for catch-all default. |
| **channel** | ENUM | NOT NULL | `IN_APP \| EMAIL \| SMS`. Delivery method this preference controls. |
| **is_enabled** | BOOLEAN | NOT NULL, Default true | Whether notifications of this type/channel are active. |
| **digest** | ENUM | NOT NULL, Default `IMMEDIATE` | Batching mode: `IMMEDIATE` (send as it happens) \| `HOURLY` (batch every hour) \| `DAILY` (batch each day) \| `OFF` (suppress). CRITICAL priority notifications bypass digesting. |
| **created_at** | TIMESTAMPTZ | NOT NULL, NOW() | Record creation. |
| **updated_at** | TIMESTAMPTZ | NOT NULL, NOW() | Last preference change. |

* **Unique constraint:** `(user_id, type, channel)` — one row per (type, channel) pair per user.
* **Resolution order:** Lookup exact `(type, channel)` preference. If missing, fall back to `('*', channel)`. If missing, use hard-coded default (`is_enabled = true`, `digest = IMMEDIATE`). Quiet hours (`quiet_hours_start`, `quiet_hours_end`, `timezone`) live on the `users` table as global settings, not here.

## **3. Recommended Foreign Key Cascade Rules**

To prevent accidental database corruption or orphaned child records:

1. **ON DELETE CASCADE:**
   * user_departments ➔ users & departments.
   * `_user_roles` ➔ users & roles (implicit m2m; Prisma generates the CASCADE).
   * `_role_permissions` ➔ roles & permissions (implicit m2m; Prisma generates the CASCADE).
   * department_documents ➔ documents & departments.
   * ticket_messages ➔ tickets (If a ticket is hard-deleted, drop its messages).
   * ticket_assignments ➔ tickets (If a ticket is hard-deleted, drop its assignment history).
   * message_attachments ➔ ticket_messages.
   * document_chunks ➔ documents.
   * device_sessions ➔ users.
   * two_factor_backup_codes ➔ users.
   * otps ➔ users (an expired verification code has no compliance value).
   * password_reset_tokens ➔ users.
   * user_invitations ➔ organizations (offboarding a tenant discards its outstanding invitations; nobody may redeem membership in a tenant that no longer exists).
   * notification_deliveries ➔ notifications (If a notification is hard-deleted, drop delivery records).
   * notifications ➔ users (If a user is hard-deleted, drop their notifications).
   * notification_preferences ➔ users (If a user is hard-deleted, drop their preference settings).
   * document_flags ➔ documents (If a document is hard-deleted, drop quality flags).
2. **ON DELETE SET NULL:**
   * deleted_by_id ➔ users.id (If an admin user account is hard-deleted, preserve the deletion timestamp while setting deleted_by_id to NULL).
   * assigned_by_id ➔ users.id (in ticket_assignments; if the assigning user is deleted, retain the assignment record).
   * created_by_id ➔ users.id (If creator is deleted, retain the created entity).
   * related_document_id ➔ documents.id (in document_flags; if a related conflicting document is deleted, retain the flag as informational).
   * resolved_by_id ➔ users.id (in document_flags; if a Knowledge Manager is hard-deleted, retain the resolution record).
   * actor_id ➔ users.id (in notifications; if the user who triggered the notification is deleted, retain the notification).
   * invited_by_id, accepted_user_id, revoked_by_id ➔ users.id (in user_invitations; the invitation record outlives any of the accounts referenced by it).
3. **ON DELETE RESTRICT / NO ACTION (Default):**
   * tickets ➔ users (Do not allow deleting a user if they own active historical support tickets; soft-delete the user instead).
   * documents ➔ organizations.
