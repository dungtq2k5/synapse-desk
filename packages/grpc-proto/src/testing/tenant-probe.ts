/**
 * The cross-tenant probe's machinery: which RPCs take an id, what a request
 * looks like on the wire, and what "tenant A was not touched" means in a
 * database.
 *
 * A service's probe spec seeds tenant A with one of everything and tenant B
 * with a caller, then calls every id-taking RPC **as B on A's ids** and holds
 * three things:
 *
 * - **A's rows are unchanged**, and nothing new references them;
 * - **the answer names none of A's identifiers**;
 * - **the answer is the one a missing id gets**: the same code and details,
 *   or the same response, with ids and times normalized.
 *
 * The method list is read from the proto files, so a new RPC with an id field
 * joins the probe, and the spec's table must say how to call it.
 *
 * **Test-only**: `tsconfig.build.json` excludes `src/testing`.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { isObservable, lastValueFrom, toArray } from 'rxjs';
import * as protobuf from 'protobufjs';
import { PROTO_ROOT } from '../constants';
import { packRequestContext } from '../metadata';

export type ProtoPackage = 'auth' | 'ticket' | 'ingestion' | 'notification';

/** An RPC whose request names a resource by id, as `Service/Method`. */
export type IdTakingMethod = {
  name: string;
  /** The request's string fields named `id`, `…Id` or `…Ids` (camelCase). */
  idFields: string[];
  requestType: protobuf.Type;
};

/** The tenant field a service-to-service request carries; not a resource id. */
const NOT_A_RESOURCE_ID = new Set(['organizationId']);

function loadPackage(pkg: ProtoPackage): protobuf.Root {
  const root = new protobuf.Root();
  root.resolvePath = (_origin, target) => join(PROTO_ROOT, target);
  const directory = join(PROTO_ROOT, 'synapsedesk', pkg);
  const files = readdirSync(directory)
    .filter((file) => file.endsWith('.proto'))
    .map((file) => join('synapsedesk', pkg, file));
  root.loadSync(files, { keepCase: false });
  root.resolveAll();

  return root;
}

/**
 * Every RPC of `pkg`'s services whose request has an id field.
 *
 * @example idTakingMethods('notification').map((m) => m.name) // ['NotificationService/MarkRead', …]
 */
export function idTakingMethods(pkg: ProtoPackage): IdTakingMethod[] {
  const namespace = loadPackage(pkg).lookup(
    `synapsedesk.${pkg}`,
  ) as protobuf.Namespace;
  const found: IdTakingMethod[] = [];

  for (const service of namespace.nestedArray) {
    if (!(service instanceof protobuf.Service)) continue;
    for (const method of service.methodsArray) {
      const requestType = method.resolvedRequestType as protobuf.Type;
      const idFields = requestType.fieldsArray
        .filter(
          (field) =>
            field.type === 'string' &&
            !NOT_A_RESOURCE_ID.has(field.name) &&
            /^id$|Ids?$/u.test(field.name),
        )
        .map((field) => field.name);
      if (idFields.length > 0) {
        found.push({
          name: `${service.name}/${method.name}`,
          idFields,
          requestType,
        });
      }
    }
  }

  return found;
}

/**
 * The request a controller receives when the caller sent `overrides`: every
 * unset field at its proto3 default, decoded with the loader's options.
 */
export function wireRequest(
  method: IdTakingMethod,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const type = method.requestType;
  const decoded = type.toObject(
    type.decode(type.encode(type.fromObject(overrides)).finish()),
    {
      defaults: true,
      longs: Number,
      enums: Number,
      oneofs: true,
    },
  );

  return decoded;
}

/** Calls a handler and settles it: a stream is collected, a throw becomes an outcome. */
export async function settle(run: () => unknown): Promise<Outcome> {
  try {
    const result = await Promise.resolve().then(run);
    const value = isObservable(result)
      ? await lastValueFrom(result.pipe(toArray()))
      : result;

    return { kind: 'resolved', value };
  } catch (error) {
    if (error instanceof RpcException) {
      const body = error.getError() as {
        code?: number;
        details?: string;
        message?: string;
      };

      return {
        kind: 'rejected',
        code: body.code,
        details: body.details ?? body.message ?? JSON.stringify(body),
      };
    }

    return { kind: 'error', details: String(error) };
  }
}

export type Outcome =
  | { kind: 'resolved'; value: unknown }
  | { kind: 'rejected'; code: number | undefined; details: string }
  | { kind: 'error'; details: string };

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu;
const ISO = /\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/gu;

/**
 * An outcome with every uuid and time replaced, so A's id and a missing id
 * compare equal when the service answered both the same way.
 */
export function normalized(outcome: Outcome): string {
  return JSON.stringify(outcome, (_key, value: unknown) => {
    if (typeof value === 'string') {
      return value.replace(UUID, '<uuid>').replace(ISO, '<time>');
    }
    if (value instanceof Date) return '<time>';
    if (
      value !== null &&
      typeof value === 'object' &&
      'seconds' in value &&
      'nanos' in value
    ) {
      return '<time>';
    }

    return value;
  });
}

/** `request` with every one of `identifiers` swapped for a fresh uuid. */
export function withMissingIds(
  request: Record<string, unknown>,
  identifiers: ReadonlySet<string>,
): Record<string, unknown> {
  const swapped = new Map<string, string>();

  return JSON.parse(JSON.stringify(request), (_key, value: unknown) => {
    if (typeof value !== 'string' || !identifiers.has(value)) return value;
    if (!swapped.has(value)) swapped.set(value, crypto.randomUUID());

    return swapped.get(value);
  }) as Record<string, unknown>;
}

type RawClient = {
  $queryRawUnsafe: <T>(query: string) => Promise<T>;
};

/** Every row of every table in the schema, as JSON text, by table. */
export type Snapshot = Map<string, Set<string>>;

export async function snapshot(prisma: RawClient): Promise<Snapshot> {
  const tables = await prisma.$queryRawUnsafe<{ name: string }[]>(
    `SELECT table_name AS name FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
        AND table_name NOT LIKE '\\_prisma%'`,
  );
  const result: Snapshot = new Map();

  for (const { name } of tables) {
    const rows = await prisma.$queryRawUnsafe<{ row: string }[]>(
      `SELECT row_to_json(t)::text AS row FROM "${name}" t`,
    );
    result.set(name, new Set(rows.map(({ row }) => row)));
  }

  return result;
}

const same = (left: Snapshot, right: Snapshot) =>
  [...left].every(([table, rows]) => {
    const other = right.get(table);

    return (
      other?.size === rows.size && [...rows].every((row) => other.has(row))
    );
  });

/**
 * A snapshot taken once two in a row agree, so a fire-and-forget write the
 * call started (the ledger's) lands before it's read. Gives up after ~1 s.
 */
export async function quietSnapshot(prisma: RawClient): Promise<Snapshot> {
  let previous = await snapshot(prisma);
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const next = await snapshot(prisma);
    if (same(previous, next)) return next;
    previous = next;
  }

  return previous;
}

/**
 * The identifiers that belong to `organizationId`: the organization itself,
 * the id of every row that names it, and, to a fixed point, the id of every
 * row that names one of those (the child tables carry no tenant column).
 */
export function tenantIdentifiers(
  rows: Snapshot,
  organizationId: string,
): Set<string> {
  const owned = new Set([organizationId]);
  const all = [...rows.values()].flatMap((set) => [...set]);
  let grew = true;

  while (grew) {
    grew = false;
    for (const row of all) {
      const id = (JSON.parse(row) as { id?: unknown }).id;
      if (typeof id !== 'string' || owned.has(id)) continue;
      if ([...owned].some((known) => row.includes(known))) {
        owned.add(id);
        grew = true;
      }
    }
  }

  return owned;
}

/**
 * What changed in A's data between two snapshots: a row that names one of
 * A's identifiers and vanished or changed, or a new row that names one of A's
 * rows here (`local`). A new row naming only a `foreign` id (a user or a
 * department another service owns) is the caller's own write of a reference
 * it can't check, not a change to A.
 */
export function tenantChanges(
  before: Snapshot,
  after: Snapshot,
  local: ReadonlySet<string>,
  foreign: ReadonlySet<string> = new Set(),
): string[] {
  const names = (row: string, ids: ReadonlySet<string>) =>
    [...ids].some((id) => row.includes(id));
  const changes: string[] = [];

  for (const [table, rows] of before) {
    const next = after.get(table) ?? new Set<string>();
    for (const row of rows) {
      if ((names(row, local) || names(row, foreign)) && !next.has(row)) {
        changes.push(`${table}: lost ${row}`);
      }
    }
    for (const row of next) {
      if (names(row, local) && !rows.has(row))
        changes.push(`${table}: gained ${row}`);
    }
  }

  return changes;
}

/**
 * Which of A's identifiers an answer names, leaving out those the request
 * itself carried: echoing the caller's own input tells it nothing, and an
 * answer that reached A's row differs from the missing id's anyway.
 */
export function namedIdentifiers(
  outcome: Outcome,
  identifiers: ReadonlySet<string>,
  request: Record<string, unknown>,
): string[] {
  const text = JSON.stringify(outcome);
  const sent = JSON.stringify(request);

  return [...identifiers].filter(
    (id) => text.includes(id) && !sent.includes(id),
  );
}

/** gRPC codes that mean the request never reached a tenant check. */
const MALFORMED = new Map([
  [3, 'INVALID_ARGUMENT'],
  [12, 'UNIMPLEMENTED'],
  [13, 'INTERNAL'],
]);

export type ProbeReport = {
  /** A's id answered exactly as a missing id does. */
  sameAsMissing: boolean;
  /** A's identifiers the answer names. */
  namesA: string[];
  /** A's rows the call changed, or new rows naming them. */
  changedA: string[];
  /** Why the answer can't speak for the tenant check, or null. */
  malformed: string | null;
  /** The answer on A's ids, normalized, for the failure message. */
  onA: string;
  /** The answer on missing ids, normalized. */
  onMissing: string;
};

/**
 * Calls one RPC as tenant B twice, on A's ids and on missing ones, and
 * reports what a cross-tenant reach would show.
 *
 * @example expect(await probeCall({ request, call, local, foreign, prisma })).toMatchObject(CLEAN)
 */
export async function probeCall(options: {
  request: Record<string, unknown>;
  call: (request: Record<string, unknown>) => unknown;
  /** A's rows in this database, from `tenantIdentifiers`. */
  local: ReadonlySet<string>;
  /** A's ids that live in other services: users, departments, tickets… */
  foreign: ReadonlySet<string>;
  prisma: RawClient;
}): Promise<ProbeReport> {
  const { request, call, local, foreign, prisma } = options;
  const identifiers = new Set([...local, ...foreign]);
  const onMissing = await settle(() =>
    call(withMissingIds(request, identifiers)),
  );
  const before = await snapshot(prisma);
  const onA = await settle(() => call(request));
  const after = await quietSnapshot(prisma);

  return {
    sameAsMissing: normalized(onA) === normalized(onMissing),
    namesA: namedIdentifiers(onA, identifiers, request),
    changedA: tenantChanges(before, after, local, foreign),
    malformed:
      onA.kind === 'error'
        ? onA.details
        : onA.kind === 'rejected' && MALFORMED.has(onA.code ?? -1)
          ? `${MALFORMED.get(onA.code ?? -1)}: ${onA.details}`
          : null,
    onA: normalized(onA),
    onMissing: normalized(onMissing),
  };
}

/**
 * What a Super Admin gets on a tenant RPC, called on A's ids with no tenant:
 *
 * - `refused <CODE>`: the RPC turned them away;
 * - `reaches`: the answer names A's data (beyond what the request carried),
 *   or the call changed A's rows;
 * - `answers`: it ran, and touched nothing of A's.
 *
 * @example await superAdminReach({ request, call, local, foreign, prisma }) // 'refused FAILED_PRECONDITION'
 */
export async function superAdminReach(options: {
  request: Record<string, unknown>;
  call: (request: Record<string, unknown>) => unknown;
  local: ReadonlySet<string>;
  foreign: ReadonlySet<string>;
  prisma: RawClient;
}): Promise<string> {
  const { request, call, local, foreign, prisma } = options;
  const before = await snapshot(prisma);
  const outcome = await settle(() => call(request));
  const after = await quietSnapshot(prisma);

  if (outcome.kind === 'rejected') {
    return `refused ${status[outcome.code ?? -1] ?? String(outcome.code)}`;
  }
  if (outcome.kind === 'error') return `error ${outcome.details}`;

  const named = namedIdentifiers(
    outcome,
    new Set([...local, ...foreign]),
    request,
  );
  const changed = tenantChanges(before, after, local, foreign);

  return named.length > 0 || changed.length > 0 ? 'reaches' : 'answers';
}

/** What a probe row expects: no reach, and an answer that speaks for the check. */
export const CLEAN = {
  sameAsMissing: true,
  namesA: [],
  changedA: [],
  malformed: null,
} as const;

/**
 * A call to `Service/Method` on the Nest controller that serves it, with the
 * caller's context packed as the gateway packs it.
 *
 * @example controllerCall({ TicketService: tickets }, 'TicketService/GetTicket', asB)
 */
export function controllerCall(
  controllers: Record<string, object>,
  name: string,
  context: Parameters<typeof packRequestContext>[0],
): (request: Record<string, unknown>) => unknown {
  const [service, method] = name.split('/');
  const controller = controllers[service] as Record<
    string,
    (request: unknown, metadata: unknown) => unknown
  >;
  const handler = method.replace(/^./u, (first) => first.toLowerCase());

  return (request) => controller[handler](request, packRequestContext(context));
}
