import type { Socket } from 'socket.io';

/**
 * Lazily reads a per-socket store off `client.data`, creating it on first use.
 *
 * **Per-socket state lives on the socket, deliberately.** `client.data` dies
 * with the connection, so a disconnect — clean, abrupt, or a pod that crashed —
 * leaves nothing to prune. The alternative, a provider-level `Map` keyed by
 * socket id, needs a `handleDisconnect` to stay correct and still leaks the
 * entries belonging to an instance that died without running one.
 *
 * It exists as a function because `client.data` is typed `any` by socket.io, so
 * every call site otherwise repeats the same two things: an
 * `eslint-disable-next-line` for the unsafe member access, and a cast asserting
 * what was just written. Both now happen once, here, where the unsafety is one
 * line rather than one line per store.
 *
 * `??=` rather than a `has`/`set` pair so the read and the create cannot
 * interleave — an ordinary object property assignment is not a place a second
 * caller can land, but writing it as two statements invites someone to add an
 * `await` between them later.
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
