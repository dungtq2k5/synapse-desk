import type { Socket } from 'socket.io';

/**
 * Lazily reads a per-socket store off `client.data`, creating it on first use.
 *
 * **Per-socket state lives on the socket, deliberately.** `client.data` dies
 * with the connection, so a disconnect — clean, abrupt, or a pod that crashed —
 * leaves nothing to prune. A provider-level `Map` keyed by socket id needs a
 * `handleDisconnect` to stay correct and still leaks entries belonging to an
 * instance that died without running one.
 *
 * A function because `client.data` is typed `any` by socket.io: the
 * `eslint-disable` and the cast happen once here rather than at every call
 * site.
 *
 * `??=` rather than a `has`/`set` pair, so nobody is invited to add an `await`
 * between the read and the create later.
 */
export function socketStore<T>(
  client: Socket,
  key: string,
  create: () => T,
): T {
  const data = client.data as Record<string, unknown>;

  data[key] ??= create();

  return data[key] as T;
}
