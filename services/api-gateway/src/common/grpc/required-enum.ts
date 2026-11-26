import { BadGatewayException, Logger } from '@nestjs/common';

const logger = new Logger('RequiredEnum');

/**
 * A proto enum field the peer always fills, mapped to its domain value. The
 * zero value, or a number this gateway doesn't know, is a peer's bug: answered
 * 502, naming the field and what came, and logged, never mapped to `null`. A
 * value that slipped past the peer's write validation reaches here as the zero
 * value; the peer logs the original string as it converts it.
 *
 * @example status: requiredEnum('status', ticket.status, fromProtoTicketStatus)
 */
export function requiredEnum<V, D>(
  field: string,
  value: V,
  fromProto: (value: V) => D | null,
): D {
  const mapped = fromProto(value);
  if (mapped !== null) return mapped;

  const got = value === undefined ? 'nothing' : JSON.stringify(value);
  logger.error(`A service sent ${got} for ${field}, which always has a value`);
  throw new BadGatewayException(
    `A service sent ${got} for ${field}, which always has a value`,
  );
}
