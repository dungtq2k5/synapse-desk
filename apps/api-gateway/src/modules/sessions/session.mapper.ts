import {
  fromProtoTimestamp,
  requireProtoTimestamp,
  SessionResponse,
} from '@synapsedesk/grpc-proto';
import { SessionResponseDto } from './dto/rest/session.dto';

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
