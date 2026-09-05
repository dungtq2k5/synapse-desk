# GraphQL API

The read surface for the SPA. Twenty queries, four mutations, no subscriptions.

Written for the front-end teams building against it. Everything here was read
off `apps/api-gateway/src/schema.gql` and the resolvers behind it; where a
number matters it is named with the constant that owns it, so a change to the
constant is a change to this document.

---

## 1. Endpoint and transport

```
POST /graphql
Authorization: Bearer <access token>
Content-Type: application/json
```

**`/graphql`, not `/api/v1/graphql`.** `GLOBAL_PREFIX` is `/api/v1` and it
applies to controller routes; the Apollo driver mounts its own handler outside
it. REST lives under the prefix, GraphQL does not, and the two are permanent
siblings rather than one replacing the other.

**One public field, `version`; everything else is authenticated.**
`version.resolver.ts` carries no guard and says so — *"PUBLIC, like
`GET /version` — no guard"* — and the e2e sends no cookie and no header and gets
`200` with real data. Every other resolver class carries
`@UseGuards(JwtAuthGuard, PermissionGuard)`.

**A rejected request is HTTP `200`, not `401`.** The guards run **per field,
inside execution**, so the response carries `data` *and* `errors` together:

```json
{ "data": { "tickets": null }, "errors": [ … ] }
```

That is GraphQL's convention rather than a quirk of this gateway, and it is the
single easiest thing to get wrong here: **a client branching on
`res.status === 401` treats every rejection as success.** Branch on
`body.errors`, and read `extensions.code` on each.

**Introspection** is on outside production and off in it, so a schema-aware IDE
works locally and against staging and stops working in prod. The playground is
off everywhere.

**`POST` is the supported transport.** The Apollo config sets no
`csrfPrevention`, so Apollo Server 5's default applies and a `GET` query would
need a preflight-safe header; nothing in this repository exercises that path and
nothing here should be read as a promise about it.

---

## 2. What belongs here and what belongs to REST

The gateway's own module docblock states the division and it is worth repeating
verbatim, because half a feature drifting into the wrong surface is the failure
it exists to prevent:

> **REST is not deprecated by it; both are permanent, with different jobs.**
> REST stays the surface for commands, files and machine callers; GraphQL is the
> read surface for the SPA.

In practice:

| you want | go to |
| :--- | :--- |
| a screen's worth of data in one round trip | **GraphQL** |
| uploading or downloading a file | REST — the presign flow |
| creating a ticket, a user, a role | REST |
| four ticket mutations that a list screen needs inline | **GraphQL** (§4) |
| anything a non-browser client calls | REST — it is versioned and documented in OpenAPI |
| live updates | **neither** — see `docs/websocket-api.md` |

**There is no `Subscription` type**, deliberately. Realtime is Socket.IO, and
its contract is a separate document. A client that polls a GraphQL query for
updates is doing the thing the WebSocket exists to replace.

---

## 3. Queries

Twenty, grouped by what they read. The permission column is the
`@RequirePermission` on the field; where it says *(none)* the field is still
behind authentication — with exactly one exception, `version`, which is public
(§1).

### Identity

| field | returns | permission |
| :--- | :--- | :--- |
| `me` | `User` | *(none)* — reading your own profile is not an administrative act |
| `user(id)` | `User` | `user.read` |
| `users(first, page, searchTerm)` | `UserPage` | `user.read` |

### Tickets

| field | returns | permission |
| :--- | :--- | :--- |
| `ticket(id)` | `Ticket` | *(none)* — visibility is enforced by ticket-service |
| `tickets(…)` | `TicketPage` | *(none)* — same |

`tickets` filters on `assigneeId`, `authorId`, `departmentId`, `priority`,
`status`, `source` and `sortBy`. `source: CHAT` alone is the tenant-wide chat
queue; pair it with `authorId` for "my conversations".

### Knowledge base

| field | returns | permission |
| :--- | :--- | :--- |
| `document(id)` | `Document` | `document.read` |
| `documents(first, page, searchTerm)` | `DocumentPage` | `document.read` |
| `ingestionJob(id)` | `IngestionJob` | `document.read` |
| `ingestionJobs(…)` | `IngestionJobPage` | `document.read` |

`ingestionJobs` additionally filters on `documentId` and `status`.

### Organisation

| field | returns | permission |
| :--- | :--- | :--- |
| `departments(first, page, searchTerm)` | `DepartmentPage` | `department.read` |
| `role(id)` | `Role` | `role.read` |
| `roles(first, page, searchTerm)` | `RolePage` | `role.read` |
| `permissions` | `[Permission!]!` | `role.read` |

`permissions` returns the **full catalogue including retired codes**. A retired
code is still held by roles that were granted it and can never be granted again
— render it, do not offer it.

### Notifications

| field | returns | permission |
| :--- | :--- | :--- |
| `notifications(first, cursor)` | `NotificationFeed` | *(none)* — your own feed |
| `unreadNotificationCount` | `Int!` | *(none)* |

**`unreadNotificationCount` is a number, not a list.** Counting by fetching is
precisely what it exists to avoid; a badge should call this, never
`notifications` with a large `first`.

### Analytics

| field | returns | permission |
| :--- | :--- | :--- |
| `analyticsOverview(from, to)` | `AnalyticsOverview` | `analytics.read` |
| `analyticsAgents(from, to)` | `AgentAnalytics` | `analytics.read` |
| `analyticsDocuments(limit)` | `DocumentAnalytics` | `analytics.read` |
| `analyticsKnowledgeGaps(from, to, limit)` | `KnowledgeGaps` | `analytics.read` |

`from` and `to` are `String!` date bounds, not `DateTime`.

### Build

| field | returns | auth |
| :--- | :--- | :--- |
| `version` | `Version!` | **public** — no token at all, the GraphQL twin of `GET /version` |

---

## 4. Mutations

Four, all ticket- or notification-shaped, all things a list screen needs
without a page change.

| field | returns | permission |
| :--- | :--- | :--- |
| `assignTicket(id, assigneeId, departmentId)` | `TicketMutationPayload!` | `ticket.assign` |
| `transitionTicketStatus(id, status, reason)` | `TicketMutationPayload!` | `ticket.update` |
| `escalateTicket(id)` | `TicketMutationPayload!` | *(none)* — escalating is what an agent does when they cannot help, and gating it would leave them stuck |
| `markNotificationRead(id)` | `MarkNotificationReadPayload!` | *(none)* — your own feed |

`TicketMutationPayload` is `{ ticket: Ticket!, message: String }` — the mutated
ticket in full, so a list can re-render from the response without a follow-up
query.

`MarkNotificationReadPayload` is `{ id: ID!, unreadCount: Int! }`. **It returns
the new badge count**, so a client that marks one read does not need to follow
up with `unreadNotificationCount` — the mutation already gave it to you.

**All three `assignTicket` arguments are required**, `departmentId` included.

**`transitionTicketStatus` runs ticket-service's transition table.** An illegal
move is an error, not a silent no-op; check `errors` before assuming the status
changed.

**`markNotificationRead` is idempotent.** Re-reading an already-read row
succeeds and changes nothing.

---

## 5. Pagination — two shapes, and they are not interchangeable

**Offset pages**, everywhere except notifications:

```graphql
tickets(first: 20, page: 2) {
  items { id title }
  meta { currentPage itemsPerPage itemCount totalItems totalPages }
}
```

**A cursor feed**, for notifications only:

```graphql
notifications(first: 20, cursor: $cursor) {
  items { id readAt }
  nextCursor
  hasMore
}
```

The feed is a cursor because it is append-heavy and read newest-first, where an
offset page shifts under you as new rows arrive. Everything else is offset
because the screens are tables with page numbers.

**`first` is clamped, not rejected.** `MAX_PAGE_SIZE` is **100**; asking for 500
returns 100 rather than an error, so a client that worked yesterday keeps
working. Read `meta.itemsPerPage` if you need to know what you actually got.

---

## 6. `User` and `UserSummary` are different types on purpose

```graphql
me            → User          # full profile, contact details
user(id: …)   → User          # behind user.read
ticket { assignee }  → UserSummary   # id, name, avatar
```

`Query.user` carries `@RequirePermission('user.read')` and `Ticket.assignee`
does not — **and that is the whole reason the two return different types.** The
full `User` is reachable only through a query applying the same check the REST
route applies; an edge reaches `UserSummary`, which has no contact details to
protect.

So `{ ticket { assignee { email } } }` is a **validation error**, not a
permission error: `Cannot query field "email" on type "UserSummary"`. If you
need the email, you need `user(id:)` — or `users`, below.

`UserSummary` is exactly five fields:

```graphql
type UserSummary { id: ID!  fullName: String!  avatarUrl: String  deletedAt: DateTime  isLocked: Boolean! }
```

`deletedAt` and `isLocked` are there for the assignee chip: a departed or locked
agent still owns tickets, and the row has to render.

**`users` returns full `User` rows, not summaries** — `UserPage.items` is
`[User!]!`, with `email`, `phoneNumber`, `dob` and `lastLoginAt`, behind
`user.read`. The schema's own docstring on `users` still says "summaries" and is
stale; the resolver records why it changed — a page of `UserSummary` failed
`User.id` and *"took the whole query's data with it."*

The practical consequence: **do not follow a `users` page with `user(id:)` calls
to get contact details.** You already have them.

---

## 7. Edges, batching, and why nothing here paginates

Every cross-service edge — `assignee`, `author`, `sender`, `department`,
`departments`, `createdBy`, `actor`, `agent`, `document` — is resolved through
a DataLoader. **Fifty tickets asking for `assignee` is one call to
auth-service, not fifty.** Ask for the numbers alone and no call is made at all:
`analyticsAgents { items { resolved } }` never reaches auth-service,
while adding `agent { fullName }` does.

List edges come in three shapes and the difference is cardinality:

| edge | shape | ceiling |
| :--- | :--- | :--- |
| `Ticket.messages(first: 50)` | head-of-thread cap, **oldest first** | clamped to `MAX_PAGE_SIZE` = **100** |
| `User.departments`, `Document.departments` | cap | `MAX_EDGE_LIST` = **50** |
| `Role.permissions` | neither — filtered from the tenant catalogue by the codes the role holds | the catalogue's size |

**None of these paginates, `messages` included.** The resolver hard-codes
`page: 1` and the schema exposes no `page`, `offset` or `after` argument, so
there is no second page to ask for: `messages(first: n)` returns the first `n`
of the thread, oldest first, and **a thread longer than 100 messages is not
reachable through GraphQL.** Use the REST message list for a long thread.

Note the two caps are different numbers — 100 for messages, 50 for the
department edges — and neither is negotiable from the client.

**`Document.departmentCount` and `User.departmentCount` are how you detect the
cut.** They are local fields (`departmentIds.length`, no call, cost 1), so
`departmentCount > departments.length` means the edge was capped. Ask for the
count whenever you render the list.

Internal notes are filtered out of `messages` for callers without agent access —
by ticket-service, applying the same rule as the REST list and the WebSocket
fan-out, so the three cannot disagree.

### The edge types are leaves, and that answers "how deep can I go?"

`UserSummary`, `Department` and `Permission` have **no object-typed fields at
all** — verified against the whole schema. Every cross-service edge returns one
of those three, so an edge is where traversal stops.

Exactly two paths in the schema nest further:

```
Ticket.messages → TicketMessage.sender
IngestionJob.document → Document.createdBy | Document.departments
```

That is the entire nesting surface. From a ticket list the only nesting
available is `messages { sender }` — and that is also the one shape that puts a
list under a list, which is what the multiplier charges for.

So `MAX_QUERY_DEPTH = 7` is generous rather than tight: you would have to work
to reach it. **The `messages` cap is the one traversal decision a client
actually has to make.**

---

## 8. Limits, and the two errors you will meet

Three limits, and they are **not the same kind of thing** — two reject, one
silently reduces:

| limit | value | constant | what it does |
| :--- | :--- | :--- | :--- |
| nesting depth | **7** | `MAX_QUERY_DEPTH` | **rejects** at validation, before execution |
| scored complexity | **2000** | `MAX_QUERY_COMPLEXITY` | **rejects** before execution |
| items per page | **100** | `MAX_PAGE_SIZE` | **clamps** in the args DTO — you get 100 and no error |

**Complexity is weighted, and the weighting is the point.** A field costs:

| kind | cost |
| :--- | :--- |
| scalar already on the parent | **1** |
| cross-service field resolved through a loader | **10** |
| list field | multiplies its children by the number of items requested |

Ten rather than a hundred for a cross-service field because DataLoader batches:
fifty of them on one page is one call, so pricing each at a full round trip
would push clients back to N separate queries.

A 50-ticket page with two cross-service edges, asking only for ids —
`tickets(first: 50) { items { id assignee { id } department { id } } }` —
measures **1201**. Add a name to each edge and it is 1301; add a title and a
`meta` block and it is 1451. All comfortably under, and the shape is worth
naming because the number moves with every scalar you add per row.

### The rule that decides most real queries: a variable costs the maximum

**`first: $n` is priced at `MAX_PAGE_SIZE`, whatever you pass.** The scorer runs
before variable coercion and reads the query text, so it cannot know your value:

> A VARIABLE cannot be read here … so a variable is priced at the cap. Pricing
> it at 1 would make `first: $n` the universal way around this limit.

Every real client parameterises its page size, so this is the rule that decides
whether your query is accepted — and it means **`first: $first` costs the same
as `first: 100`.** Measured on §11's query: `first: 20` scores **742** and
`first: $first` scores **3702**, rejected.

If a parameterised list query is refused, the fix is not a smaller variable —
the variable is already being charged at 100. Drop a cross-service edge, or
split the query.

### One root query is not free

`Query.document(id:)` is in `CROSS_SERVICE_FIELDS`, so it scores **10** rather
than 1. Every other root query is a scalar-cost entry point.

### The cheapest advice in this document

**The flat ids cost 1 where the edge costs 10.** `Ticket.currentAssigneeId`,
`Ticket.authorId` and `Ticket.currentDepartmentId` are already on the parent —
the resolver says `currentAssigneeId` *"is the field that costs nothing, and it
is exposed for exactly that reason."*

So a list that only needs to know *which* agent, not their name, should ask for
`currentAssigneeId` and never `assignee { id }`. On a 100-row page that is the
difference between 100 and 1000, for identical data.

**The two rejections:**

```json
{ "errors": [{
  "message": "Query is nested 9 levels deep, exceeding the maximum of 7.",
  "extensions": { "code": "QUERY_TOO_DEEP", "depth": 9, "maxDepth": 7 }
}]}
```

```json
{ "errors": [{
  "message": "Query is too complex: 3400 exceeds the maximum of 2000. Request fewer items, or fewer fields that resolve across services.",
  "extensions": { "code": "QUERY_TOO_COMPLEX", "cost": 3400, "maxComplexity": 2000 }
}]}
```

Both arrive as **HTTP 400** with no `data` — a query refused during validation
never became an operation, and no peer was called. Note that Apollo stamps every
validation failure as `GRAPHQL_VALIDATION_FAILED` in the top-level code; the
specific code above survives in `extensions` for a client that reads it.

**What to do about each:** `QUERY_TOO_DEEP` means restructure — you almost
certainly want a second query rather than a deeper one. `QUERY_TOO_COMPLEX`
means ask for fewer items or drop a cross-service edge; the numbers in
`extensions` tell you how far over you are.

---

## 9. Nulls, and the three different things one means

A null field is not one condition here. The schema distinguishes three, on
almost every nullable field, and a client that renders them the same way gets
two of them wrong.

### 9a. Deliberately indistinguishable — the single-item queries

`ticket(id:)`, `document(id:)`, `role(id:)` and `ingestionJob(id:)` each return
`null` for a merged set of reasons, worded per field. `ticket(id:)`'s is the
broadest: *"does not exist, or belongs to another tenant, or is not visible to
this caller — the three are deliberately indistinguishable."* `document(id:)`
merges not-found with department scope; `role(id:)` merges it with tenant.
`user(id:)` carries no such description and behaves the same way.

**Do not render "no permission" from this null.** You cannot tell, and that is
the intent: distinguishing them would confirm a resource exists to someone who
may not see it.

### 9b. The row outlived what it points at — historical edges

| field | null means |
| :--- | :--- |
| `AgentStat.agent` | the account no longer exists — a rollup row outlives the user it counts |
| `DocumentUsage.document` | deleted since the rollup counted it |
| `KnowledgeGapFlag.document` | deleted since the flag was raised |
| `IngestionJob.document` | deleted since the attempt ran — the job row outlives the document |

**These carry their own fallback and you should use it.** The rollup recorded a
`title` at the time; render that, not "unknown document". The row is still a
true statement about the past — the thing it points at is what is gone.

### 9c. A peer was unreachable — `Ticket.assignee`

> Null when unassigned, **or when the user could not be resolved — one
> unreachable peer costs this field, not the response.**

**The only field that says so, but not the only field it happens to.**
`Ticket.author`, `TicketMessage.sender`, `Notification.actor`,
`Document.createdBy` and `AgentStat.agent` all resolve through the same loader
instance, so all of them go null when auth-service is unreachable — only
`assignee`'s description mentions it. `author` and `createdBy` are nullable with
no documented reason at all, which is the gap to be aware of rather than a
behaviour to rely on.

This is the one null in the schema that means *try again later*. A ticket list
stays renderable when auth-service is down; the person columns are what you
lose. Do not infer "unassigned" from a null `assignee` if the other person
fields in the same response are also null — that pattern is the peer, not the
data.

### Analytics degrade rather than fail

`AgentAnalytics`, `DocumentAnalytics` and `KnowledgeGaps` each carry:

```graphql
unavailable { source reason }
```

A non-empty `unavailable` means one leg of the composition did not answer and
the figures you got are from the rest. Render it — a dashboard that silently
drops a source is a dashboard that lies. Individual fields may also be `null`
for the same reason.

**`dataThrough` is the stalest leg's coverage, not the freshest.** These figures
span two schedulers in two services and one can be days behind the other;
reporting the fresher would let the healthy one vouch for the broken one.

**The two freshness fields are on different types.** `computedAt` exists only on
`AnalyticsOverview` — which is the one analytics type with **no `unavailable`
block** — while the three that carry `unavailable` have `dataThrough` and no
`computedAt`. So *"when did the rollups run"* against *"what do they cover"* is a
comparison you can only make on `analyticsOverview`; elsewhere `dataThrough`
stands alone.

---

## 10. What is deliberately absent

So nobody spends an afternoon looking for it:

- **`Role.users`** — the reverse edge from a role to its holders. It would need
  a `ListUsersByRoleIds` RPC that does not exist, against a precedent
  (`Ticket.messages`) that says not to invent a batch RPC for a query nobody
  makes in bulk. **`Role.userAssigned` is the count**, and the list is
  `GET /users?roleId=` on REST — the GraphQL `users` field takes no role filter.
- **`AgentStat.fullName`** — flat beside the `agent` edge you would expect it
  next to, and absent on purpose: carrying it would run the hydration leg to
  fill it on every request, which is the round trip the edge exists to avoid,
  and would give clients two ways to ask for one name with one of them always
  paid for. `agent { fullName }` is the way, and it costs nothing when you do
  not ask.
- **Subscriptions** — §2. Realtime is `docs/websocket-api.md`.
- **Mutations for anything but the four in §4** — creating, updating and
  deleting are REST commands.
- **Field-level `@ResolveField` on analytics types** — the analytics types are
  flat by design; the only edges are the three named in §7.

---

## 11. A worked example

A ticket list screen: twenty rows, each with its assignee and department, plus
the unread badge, in one round trip.

```graphql
query TicketBoard($page: Int!, $status: TicketStatus) {
  tickets(first: 20, page: $page, status: $status) {
    items {
      id
      title
      priority
      status
      createdAt
      currentAssigneeId          # cost 1 — use this if you only need the id
      assignee { id fullName avatarUrl isLocked }
      department { id name }
    }
    meta { currentPage totalPages totalItems }
  }
  unreadNotificationCount
}
```

**Measured through the real scorer against the real schema: cost 742, depth 4** —
both comfortably inside 2000 and 7.

**`first: 20` is a literal here on purpose, and this is the trap §8 describes.**
The same query with `first: $first` scores **3702 and is rejected**, because a
variable is priced at `MAX_PAGE_SIZE`. So does `first: 100`. If you parameterise
the page size — and real clients do — you are being charged for 100 rows
whatever you send, and this query no longer fits.

Two ways out, and the first is usually right:

- **Drop a cross-service edge.** `assignee` and `department` are 10 each and the
  page multiplies them. Rendering a department *name* per row is often a
  client-side lookup against a `departments` query you already made.
- **Split the query.** The badge and the list have nothing to do with each
  other; asking separately costs one more round trip and removes the
  multiplication entirely.

Measured neighbours, for calibration. Every row here was **validated against the
schema as well as scored** — see the note below for why that distinction earned
its place:

| query | cost | depth | verdict |
| :--- | :--- | :--- | :--- |
| the example above, `first: 20` | **742** | 4 | ok |
| the same with `first: $first` | **3702** | 4 | rejected on cost |
| the same with `first: 100` | **3702** | 4 | rejected on cost |
| `+ author { id fullName }` — a **third** edge | **982** | 4 | ok |
| `+ messages(first: 5) { id sender { id fullName } }` | **2062** | 5 | rejected on cost |
| `tickets(first: 50)`, two edges, ids only | **1201** | 4 | ok |

Row 4 is the shape of the advice: a *third* cross-service edge costs **982**
where raising `first` to a variable costs **3702**. Row 5 is its honest
counterweight — the one genuinely nested shape this schema offers (§7), and it
does not fit.

**So: look at `first` before you look at the shape** — and on this schema, for a
stronger reason than "nesting is cheaper". Per §7 the edge types are leaves, so
there is barely any shape to change. Depth past 4 is reachable only through
`Ticket.messages`, which is also the one path that puts a list under a list.
`first` is very nearly the only lever you have.

> **A note on how these numbers were produced, because an earlier draft of this
> table was wrong in a way worth naming.** It listed
> `assignee { departments { … } }` as a cheap, valid alternative — a query that
> **cannot run**: `assignee` is `UserSummary`, which has no `departments` field,
> exactly as §6 describes and exactly as the users resolver intends (*"an edge
> that reached it from a ticket would tell a customer which teams an agent
> belongs to"*). `scoreDocument` walks the AST and never consults the schema, so
> it prices invalid queries happily. The draft measured the cost and never
> validated the document — and then recommended, as a shape to prefer, the query
> §6 of this same document says is impossible.
>
> **No cost is quoted for it here on purpose.** Two people reconstructing "the
> example plus `departments`" from prose measured two different figures, because
> the answer depends on which fields you replace — which is the whole problem
> with pricing something that cannot execute. `INVALID` is the only fact about
> that query worth carrying.
