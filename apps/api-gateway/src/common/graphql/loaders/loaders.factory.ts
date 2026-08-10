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

/**
 * Every DataLoader available to a resolver, for ONE request.
 *
 * One entry per cross-service edge — 26-doc §3. A field resolver reaches for
 * one of these and never for a gRPC client, which is the rule that makes the
 * whole design work and the one people break, because a direct call is easier
 * to write and passes every test with a single parent row.
 */
export type RequestLoaders = {
  /** `Ticket.assignee`, `Ticket.author`, `TicketMessage.sender`, … */
  users: DataLoader<string, UserSummary | null, string>;
  /** `Ticket.department`, `Document.departments`, `User.departments`. */
  departments: DataLoader<string, DepartmentResponse | null, string>;
  /** `DocumentUsage.document`, `KnowledgeGapFlag.document` — 26-doc §3.1. */
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
 * Builds a fresh set of loaders for one request — 25-doc §6.
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
  // The caller, resolved once and shared by every loader below. Each batch RPC
  // is tenant-scoped from this context — 27-doc §1, property 1 — which is what
  // makes an id-keyed cache safe at all.
  //
  // An unauthenticated request still gets loaders: `/graphql` is reachable
  // before any guard has run, and building none would make the context factory
  // throw before Apollo has an operation to attach the error to. The loaders
  // simply resolve nothing, because the RPC behind them scopes on a tenant that
  // is not there.
  const context = callerOf(request) ?? ANONYMOUS;

  return {
    users: createUserSummaryLoader(clients.auth, context),
    departments: createDepartmentLoader(clients.auth, context),
    documents: createDocumentLoader(clients.ingestion, context),
  };
}

/** The gRPC channels the loaders dial through. */
export type LoaderClients = { auth: ClientGrpc; ingestion: ClientGrpc };

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
 * The shape every batch function must have — 27-doc §2.
 *
 * Exported here rather than in a loader file because it is the CONTRACT, and
 * the contract is what the mapping helper below enforces.
 */
export type BatchFn<K, V> = (
  keys: readonly K[],
) => Promise<(V | Error | null)[]>;

/**
 * Maps a set-shaped RPC response back onto the loader's keys — 27-doc §2.
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
 * A loader whose batch function is skipped entirely for an empty key set.
 *
 * DataLoader does not call the batch function with no keys, so this is belt and
 * braces for a caller that invokes the batch function directly — and it is
 * 27-doc §2 test 4, which exists because "an empty page still costs an RPC" is
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
      // fresh per call — `{ tenantId, id }`, which 27-doc contemplates — would
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
