import DataLoader from 'dataloader';
import type { ClientGrpc } from '@nestjs/microservices';
import type { Request, Response } from 'express';
import type {
  DepartmentResponse,
  DocumentResponse,
  UserSummary,
} from '@synapsedesk/grpc-proto';
import { createUserSummaryLoader } from './user-summary.loader';
import { createDepartmentLoader } from './department.loader';
import { createDocumentLoader } from './document.loader';
import type { RequestContext } from '@synapsedesk/common';
import { RequestContextService } from '../../../common/contexts/request.context';
import type { CacheService } from '../../cache/cache.service';

/**
 * Every DataLoader available to a resolver, for ONE request.
 *
 * One entry per cross-service edge A field resolver reaches for
 * one of these and never for a gRPC client, which is the rule that makes the
 * whole design work and the one people break, because a direct call is easier
 * to write and passes every test with a single parent row.
 */
export type RequestLoaders = {
  /** `Ticket.assignee`, `Ticket.author`, `TicketMessage.sender`, … */
  users: DataLoader<string, UserSummary | null, string>;
  /** `Ticket.department`, `Document.departments`, `User.departments`. */
  departments: DataLoader<string, DepartmentResponse | null, string>;
  /** `DocumentUsage.document`, `KnowledgeGapFlag.document` */
  documents: DataLoader<string, DocumentResponse | null, string>;
};

/**
 * What a resolver receives as its GraphQL context.
 *
 * **`res` is carried as well as `req`, and it is not decoration.** The global
 * `SmartThrottlerGuard` sets `Retry-After` and the throttler's own limit headers
 * on the response — through `res.header()` — and a context without one makes
 * that read off `undefined`, which the guard catches and reports as "rate-limit
 * storage unavailable", allowing the request through unthrottled. A missing
 * field here silently unmeters the entire GraphQL surface.
 */
export type GqlContext = {
  req: Request;
  res: Response;
  loaders: RequestLoaders;
};

/**
 * Builds a fresh set of loaders for one request
 *
 * **This is a security boundary, not a performance helper.** A DataLoader is a
 * cache keyed by id, and an id carries no tenant. Three ways to construct them,
 * and only one is correct:
 *
 *   - **Singleton** — one tenant's user, cached under a bare uuid, served to
 *     whichever request asks for that id next. A cross-tenant leak whose cause
 *     is a performance optimisation, which is the hardest kind to spot in
 *     review because the code reads as obviously good practice.
 *   - **`Scope.REQUEST` providers** — correct, and expensive in a way that
 *     spreads: conventions §2.5 records that request scope BUBBLES UP the
 *     dependency tree, so every provider injecting a loader becomes
 *     request-scoped, and so does everything injecting those. The gateway's
 *     resolvers would drag half the module graph with them.
 *   - **The context factory** — one place, no DI scope involved, fresh per
 *     request by construction.
 *
 * So this function is the ONLY place a loader is ever constructed, and
 * `loaders.spec.ts` asserts that rather than trusting it.
 */
export function createLoaders(
  request: Request,
  clients: LoaderClients,
): RequestLoaders {
  // **The caller, resolved LAZILY, and that is a bug fix rather than a style
  // choice.**
  //
  // Apollo builds this context at the START of a request — before any NestJS
  // guard has run — so `request.user` is undefined here. Reading it eagerly
  // gave EVERY request's loaders the anonymous context: no tenant, no sub, no
  // permissions. Not just unauthenticated ones.
  //
  // What that cost: `ListUsersByIds` rejects an empty `organizationId` with
  // `INVALID_ARGUMENT`, so `Ticket.assignee`, `Ticket.author`,
  // `TicketMessage.sender`, `Notification.actor` and `AgentStat.agent` all
  // failed in production — the whole user half of the entity graph. Every e2e
  // passed, because a gRPC stub answers whatever it is asked, whoever asks.
  //
  // The deferral cannot live on the context OBJECT either: Apollo clones it
  // with `Object.assign`, which fires a getter immediately. So it lives here,
  // in the batch function, which runs during execution.
  //
  // Each batch RPC is tenant-scoped from this context, property 1
  // — which is what makes an id-keyed cache safe at all.
  //
  // A genuinely unauthenticated request still gets loaders, and now they are
  // anonymous because the CALLER is, rather than because of when this ran:
  // building none would make the context factory throw before Apollo has an
  // operation to attach the error to, and the RPCs behind them resolve nothing
  // for a caller with no tenant anyway.
  //
  // **A THUNK, not a value, and this is a bug fix** — see the note above.
  // Resolved on first batch, which happens during execution, by which time the
  // guards have run and `request.user` exists.
  const context = () => callerOf(request) ?? ANONYMOUS;

  return {
    users: createUserSummaryLoader(clients.auth, context, clients.cache),
    departments: createDepartmentLoader(clients.auth, context, clients.cache),
    // **Deliberately NOT cached** The entity cache is for the
    // narrow types an edge traverses constantly; a `Document` is none of the
    // three things that make one worth caching. It is large, it changes
    // asynchronously as ingestion re-indexes it, and its only consumers are the
    // two analytics edges — cold reads where a hit would save one batched RPC
    // on a query nobody runs in a loop.
    documents: createDocumentLoader(clients.ingestion, context),
  };
}

/** The gRPC channels the loaders dial through, plus the store in front. */
export type LoaderClients = {
  auth: ClientGrpc;
  ingestion: ClientGrpc;
  cache: CacheService;
};

/**
 * The context an unauthenticated GraphQL request carries.
 *
 * Every batch RPC scopes on `organizationId`, so this resolves nothing — which
 * is the correct answer for a caller with no identity, and safer than throwing
 * from a factory that runs before Apollo can format an error.
 */
const ANONYMOUS: RequestContext = {
  sub: '',
  organizationId: null,
  isSuperAdmin: false,
  departmentIds: [],
  permissionCodes: [],
  isEmailVerified: false,
  ip: '',
  userAgent: '',
};

/**
 * The caller's context, or `undefined` on an unauthenticated request.
 *
 * `undefined` rather than a throw: `/graphql` is reachable before any guard has
 * run for introspection and for the error path, and throwing here would turn a
 * clean `UNAUTHENTICATED` into a 500 from the context factory — before Apollo
 * has an operation to attach the error to.
 */
export function callerOf(request: Request): RequestContext | undefined {
  return RequestContextService.fromRequest(request) ?? undefined;
}

/**
 * The shape every batch function must have
 *
 * Exported here rather than in a loader file because it is the CONTRACT, and
 * the contract is what the mapping helper below enforces.
 */
export type BatchFn<K, V> = (
  keys: readonly K[],
) => Promise<(V | Error | null)[]>;

/**
 * Maps a set-shaped RPC response back onto the loader's keys
 *
 * **The single highest-value function in the GraphQL work**, because the bug it
 * prevents renders a completely plausible page with the wrong people on it.
 *
 * DataLoader's core contract is POSITIONAL: given `keys`, the batch function
 * must return an array of the same length, in the same order, where `results[i]`
 * belongs to `keys[i]`. A database does not work that way —
 *
 * ```sql
 * SELECT * FROM users WHERE id IN ('c', 'a', 'b')   -- returns a, b, c
 * ```
 *
 * — so handing the response straight back assigns **a** to key `c`, **b** to key
 * `a` and **c** to key `b`. Every field resolver then renders the wrong user's
 * name against the wrong ticket. No error, no exception, and with `UserSummary`
 * being a name and an avatar, nothing on the page looks wrong.
 *
 * Add one missing id and the array is short, so everything after it shifts by
 * one: the same bug, worse, and still silent.
 *
 * **Mapped from the KEYS, never from the response.** That is the whole property:
 * the output is positional by construction, and an absent id becomes a `null` in
 * its own slot rather than a shift in every slot after it.
 *
 * **It lives here rather than in the RPC.** Making every `ListXByIds`
 * order-preserving would be a promise five services must keep and no test
 * naturally checks; this is four lines, local, and correct regardless of what
 * the RPC returns — so the RPC's contract stays "a set", which is what a
 * database gives you anyway.
 */
export function alignToKeys<K, V>(
  keys: readonly K[],
  items: readonly V[],
  keyOf: (item: V) => K,
): (V | null)[] {
  const byKey = new Map<K, V>();
  for (const item of items) byKey.set(keyOf(item), item);

  return keys.map((key) => byKey.get(key) ?? null);
}

/**
 * A loader that reads Redis before the RPC
 *
 * **The entity cache, and it goes INSIDE the batch function rather than around
 * the loader.** The positional contract ({@link alignToKeys}) must hold whether
 * a key came from Redis or from the wire, so the merge happens here, once,
 * mapped from the KEYS — a cache changes where data comes from and never the
 * ordering guarantee.
 *
 * ```txt
 * loader.load('user-123')
 *   ├─ per-request cache   → dedups within one query, free, already built
 *   └─ MISS → Redis  cache:{org}|entity:user:123|
 *        └─ MISS → ListUsersByIds, for the misses ONLY
 * ```
 *
 * **Why this layer and not a response cache**: an entity key is
 * enumerable, so `user.updated` — or, here, the gateway mutation that wrote the
 * name — evicts exactly one key. A response cache key is a hash of the
 * question, and nothing in it says which entities are in the answer. This buys
 * less per hit (the resolver tree still runs, against cheaper data) and it is
 * the difference between a cache you can reason about and one you apologise
 * for.
 *
 * **No negative caching, deliberately.** An id that resolves to nothing is
 * re-fetched every request. Remembering the absence would need a miss and a
 * cached `null` to be distinguishable, and `MGET` reports both as `null` — so
 * the distinction would have to be encoded in the value, and the failure mode
 * of getting it wrong is a live user permanently invisible behind a cached
 * "does not exist". The cost of not doing it is bounded: the ids still arrive
 * in one batch, so it is one extra RPC per request, not per row.
 *
 * **No tenant, no cache.** An anonymous request keys under no organization at
 * all; the RPC behind it resolves nothing anyway, and a shared bucket is not
 * worth the sentence explaining why it is safe.
 *
 * **What a dangling id costs, bounded.** A purged user still
 * referenced by an old ticket is a miss on every request, forever. That is one
 * extra batch RPC per request, not per row: DataLoader dedups within the query,
 * so a page of fifty tickets all naming the same dead assignee is a single
 * one-key batch. A client polling that page pays one RPC per poll — the same
 * cost it would pay with no cache at all, which is the ceiling rather than a
 * new risk. Soft-deleted users do not reach this at all: `user-summary.loader`
 * asks for `includeInactive: true`, so they resolve and cache normally.
 */
export function createCachedLoader<V>(options: {
  cache: CacheService;
  /** Resolved per batch — the caller is not known when the loader is built. */
  organizationId: () => string | null;
  /** The scope for ONE entity — `entityScope('user', id)`. */
  scopeOf: (id: string) => string;
  ttlSeconds: number;
  /** How to find an item's id, for the merge. */
  keyOf: (item: V) => string;
  /** The batch RPC, called with the MISSES only. */
  fetch: (ids: string[]) => Promise<V[]>;
  maxBatchSize?: number;
}): DataLoader<string, V | null, string> {
  const { cache, scopeOf, ttlSeconds, keyOf, fetch } = options;

  return createLoader<string, V>(
    async (ids) => {
      const keys = [...ids];
      const organizationId = options.organizationId();

      if (!organizationId) {
        return alignToKeys(keys, await fetch(keys), keyOf);
      }

      const cached = await cache.mget<V>(
        keys.map((id) => ({ organizationId, scope: scopeOf(id) })),
      );

      const misses = keys.filter((_, index) => cached[index] === null);
      const fetched = misses.length > 0 ? await fetch(misses) : [];

      if (fetched.length > 0) {
        await cache.msetEx(
          fetched.map((item) => ({
            input: { organizationId, scope: scopeOf(keyOf(item)) },
            value: item,
          })),
          ttlSeconds,
        );
      }

      // **Mapped from the KEYS.** A partial hit is exactly where a naive merge
      // shifts the array: concatenating hits and fetches gives an array whose
      // length is right and whose ORDER is the cache's, not the caller's —
      // and every field resolver then renders the wrong row against the wrong
      // parent, with nothing failing. Batch alignment is why this line does not move.
      const found = [
        ...cached.filter((item): item is Awaited<V> => item !== null),
        ...fetched,
      ];

      return alignToKeys(keys, found, keyOf);
    },
    { maxBatchSize: options.maxBatchSize },
  );
}

/**
 * A loader whose batch function is skipped entirely for an empty key set.
 *
 * DataLoader does not call the batch function with no keys, so this is belt and
 * braces for a caller that invokes the batch function directly — and it is
 * Covered by a test that exists because "an empty page still costs an RPC" is
 * the kind of waste that never shows up in a functional test.
 */
export function createLoader<K, V>(
  batch: (keys: readonly K[]) => Promise<(V | null)[]>,
  options?: DataLoader.Options<K, V | null, string>,
): DataLoader<K, V | null, string> {
  return new DataLoader<K, V | null, string>(
    async (keys) => (keys.length === 0 ? [] : batch(keys)),
    {
      // **The cache key is always a string.** DataLoader's default identity
      // function compares object keys by REFERENCE, so a composite key built
      // fresh per call — `{ tenantId, id }` — would
      // miss the cache every single time and turn the batch into an N+1 that
      // still passes every test.
      cacheKeyFn: (key) =>
        typeof key === 'object' && key !== null
          ? JSON.stringify(key)
          : String(key),
      ...options,
    },
  );
}
