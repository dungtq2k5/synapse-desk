import {
  fromTimestamp,
  requireTimestamp,
  SessionResponse,
} from '@synapsedesk/grpc-proto';
import { SessionResponseDto } from './dto/rest/session.dto';

export function toSessionDto(session: SessionResponse): SessionResponseDto {
  return {
    id: session.id,
    deviceName: session.deviceName ?? null,
    ipAddress: session.ipAddress,
    userAgent: session.userAgent,
    current: session.current,
    isTrusted: session.isTrusted,
    trustedUntil: fromTimestamp(session.trustedUntil) ?? null,
    expiresAt: requireTimestamp(session.expiresAt, 'expiresAt'),
    createdAt: requireTimestamp(session.createdAt, 'createdAt'),
  };
}
