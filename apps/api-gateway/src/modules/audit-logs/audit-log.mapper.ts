import { Logger } from '@nestjs/common';
import {
  AuditLogResponse,
  fromProtoAuditAction,
  fromProtoAuditResourceType,
  requireProtoTimestamp,
} from '@synapsedesk/grpc-proto';
import { AuditLogResponseDto } from './dto/rest/audit-log-response.dto';

const logger = new Logger('AuditLogMapper');

/**
 * Converts an `AuditLogResponse` off the wire into its REST DTO.
 *
 * @throws Error if `createdAt` is missing, which the proto marks non-optional.
 */
export function toAuditLogResponseDto(
  log: AuditLogResponse,
): AuditLogResponseDto {
  return {
    id: log.id,
    organizationId: log.organizationId ?? null,
    userId: log.userId ?? null,
    action: fromProtoAuditAction(log.action),
    resourceType: fromProtoAuditResourceType(log.resourceType),
    resourceId: log.resourceId ?? null,
    ipAddress: log.ipAddress ?? null,
    userAgent: log.userAgent ?? null,
    metadata: parseAuditMetadata(log.metadata, log.id),
    createdAt: requireProtoTimestamp(log.createdAt, 'createdAt'),
  };
}

/**
 * Parses an audit row's JSON `metadata` string into an object.
 *
 * Returns `{}` and warns for an empty, malformed or non-object value, so one
 * unreadable row cannot fail the whole page.
 *
 * @param raw   The `metadata` column, as JSON text.
 * @param logId The row's id, used in the warning.
 */
export function parseAuditMetadata(
  raw: string,
  logId: string,
): Record<string, unknown> {
  if (!raw) return {};

  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    logger.warn(`Audit log ${logId} has unparseable metadata`);
    return {};
  }
}
