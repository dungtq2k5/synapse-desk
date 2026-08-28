/**
 * @file Timestamp conversions and required-field helpers for the gRPC boundary.
 */

/** The runtime shape of `google.protobuf.Timestamp` under @grpc/proto-loader. */
export type ProtoTimestamp = { seconds: number; nanos: number };

/**
 * `google.protobuf.Timestamp` is NOT a `Date` on the wire. proto-loader treats
 * it as an ordinary message, so it travels as `{ seconds, nanos }`.
 */
export function toProtoTimestamp(
  date: Date | null,
): ProtoTimestamp | undefined {
  if (!date) return undefined;

  const ms = date.getTime();
  return {
    seconds: Math.floor(ms / 1000),
    nanos: (ms % 1000) * 1_000_000,
  };
}

export function fromProtoTimestamp(
  timestamp: ProtoTimestamp | undefined,
): Date | undefined {
  if (!timestamp) return undefined;

  return new Date(timestamp.seconds * 1000 + Math.floor(timestamp.nanos / 1e6));
}

/**
 * For proto fields that are non-optional. ts-proto types every message-valued
 * field as `T | undefined` — that is its convention for message fields, not
 * permission to omit them — so a missing value is a contract violation and
 * should say so rather than be papered over with a fallback date.
 */
export function requireProtoTimestamp(
  timestamp: ProtoTimestamp | undefined,
  field: string,
): Date {
  const date = fromProtoTimestamp(timestamp);
  if (!date) {
    throw new Error(`Received a message without the required ${field}`);
  }

  return date;
}

/**
 * A nested message the sender is contractually required to set.
 *
 * proto3 types every nested message as optional, so a response whose whole
 * payload is one submessage arrives as `T | undefined` and every caller either
 * asserts it away or silently propagates `undefined` into a mapper. This throws
 * with the field's name instead — the same trade `requireProtoTimestamp` makes,
 * and for the same reason: an absent required field is a peer contract
 * violation, and it should read as one in the log rather than as
 * `Cannot read properties of undefined`.
 */
export function requireField<T>(
  // `| null` as well as `| undefined`, because every `fromProto*` bridge below
  // answers null for UNSPECIFIED — and this is the function a caller reaches for
  // when null is not an acceptable answer. Typed `T | undefined`, `T` inferred
  // as `Kind | null` and the guard returned a value still typed nullable, which
  // is the opposite of what it exists to do. The body already checked both.
  value: T | null | undefined,
  field: string,
): T {
  if (value === undefined || value === null) {
    throw new Error(`Received a message without the required ${field}`);
  }

  return value;
}

/**
 * `@db.Date` columns are calendar dates — no time, no zone. Formatted from UTC
 * components so the day cannot drift for a server west of UTC.
 *
 * **The one mapper here NOT named for its return type**, and deliberately.
 * Every other conversion in this file is `to`/`from` plus the PROTO type it
 * bridges — `toProtoTimestamp`, `fromProtoOrgStatus` — because that names the
 * side a reader cannot infer. This one returns `string`, and `toString` would
 * be both meaningless and a collision with the builtin. What is worth stating
 * is the FORMAT, so that is what the name states.
 */
export function toIsoDate(date: Date | null): string | undefined {
  if (!date) return undefined;

  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');

  return `${date.getUTCFullYear()}-${month}-${day}`;
}
