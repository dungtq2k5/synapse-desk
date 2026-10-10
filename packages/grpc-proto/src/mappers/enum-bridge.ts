/**
 * Builds both directions of a domain-enum <-> proto-enum crossing from one map.
 *
 * `toProto` takes a plain `string` — Prisma hands back enumerated columns as
 * strings — and answers `unspecified` for anything it does not recognise, so it
 * never throws on a response path. `fromProto` answers `null` for the zero value
 * and for ts-proto's `UNRECOGNIZED` (-1), leaving the caller to decide whether
 * that means "no filter" or "bad request".
 *
 * `protoByDomain` must name every domain member: `Record<D, P>` is exhaustive,
 * so a member added later fails to compile until it is mapped.
 *
 * @example
 * const status = enumBridge<TicketStatus, ProtoTicketStatus>(
 *   { [TicketStatus.OPEN]: ProtoTicketStatus.TICKET_STATUS_OPEN },
 *   ProtoTicketStatus.TICKET_STATUS_UNSPECIFIED,
 * );
 *
 * export const toProtoTicketStatus = status.toProto;
 * export const fromProtoTicketStatus = status.fromProto;
 */
export function enumBridge<D extends string, P extends number>(
  protoByDomain: Record<D, P>,
  unspecified: P,
): {
  toProto: (value: string | null | undefined) => P;
  fromProto: (value: P | number | undefined) => D | null;
} {
  const domainByProto = new Map<number, D>(
    (Object.entries(protoByDomain) as [D, P][]).map(([domain, proto]) => [
      proto,
      domain,
    ]),
  );

  return {
    toProto: (value) => (value && protoByDomain[value as D]) || unspecified,
    fromProto: (value) =>
      value === undefined ? null : (domainByProto.get(value) ?? null),
  };
}
