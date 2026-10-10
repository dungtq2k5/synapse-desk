import {
  fromProtoTimestamp,
  ListSessionsResponse,
  requireProtoTimestamp,
  SessionResponse,
} from '@synapsedesk/grpc-proto';
import { SessionResponseDto } from './dto/rest/session-response.dto';

/** Converts a `SessionResponse` off the wire into its REST DTO. */
export function toSessionResponseDto(
  session: SessionResponse,
): SessionResponseDto {
  return {
    id: session.id,
    deviceName: session.deviceName ?? null,
    ipAddress: session.ipAddress,
    userAgent: session.userAgent,
    current: session.current,
    isTrusted: session.isTrusted,
    trustedUntil: fromProtoTimestamp(session.trustedUntil) ?? null,
    expiresAt: requireProtoTimestamp(session.expiresAt, 'expiresAt'),
    createdAt: requireProtoTimestamp(session.createdAt, 'createdAt'),
  };
}

/** Converts a `ListSessionsResponse` off the wire into its REST DTOs. */
export function toSessionResponseDtos(
  response: ListSessionsResponse,
): SessionResponseDto[] {
  return response.items.map(toSessionResponseDto);
}
