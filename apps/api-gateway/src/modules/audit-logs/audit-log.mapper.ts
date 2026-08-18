import { Logger } from '@nestjs/common';
import {
  AuditLogResponse,
  ListAuditLogsRequest,
  toPageRequest,
  toProtoAuditAction,
  toProtoAuditResourceType,
  toProtoTimestamp,
  ListAuditActionsResponse,
  ListAuditLogsResponse,
  fromProtoAuditAction,
  fromProtoAuditResourceType,
  requireProtoTimestamp,
} from '@synapsedesk/grpc-proto';
import { AuditAction } from '@synapsedesk/common';
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import { toPaginationMetaDataResponseDto } from '../../common/mappers/pagination.mapper';
import { ListAuditLogsQueryDto } from './dto/rest/audit-log.dto';
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

/** Converts a `ListAuditLogsResponse` into the paginated REST envelope. */
export function toAuditLogPageDto(
  response: ListAuditLogsResponse,
): PaginationResponseDto<AuditLogResponseDto> {
  return {
    items: response.items.map(toAuditLogResponseDto),
    meta: toPaginationMetaDataResponseDto(response.meta),
  };
}

/**
 * Converts a `ListAuditActionsResponse` into the filter-dropdown list.
 *
 * Drops any action this build cannot name rather than rendering it as
 * `UNSPECIFIED`, which would be an option that selects nothing.
 */
export function toAuditActionList(
  response: ListAuditActionsResponse,
): AuditAction[] {
  return response.actions
    .map(fromProtoAuditAction)
    .filter((action): action is AuditAction => action !== null);
}

/**
 * Builds a `ListAuditLogsRequest` from the REST query.
 *
 * The two enumerated filters go as UNSPECIFIED when absent — proto3's zero
 * value already carries "no filter".
 */
export function toListAuditLogsRequest(
  query: ListAuditLogsQueryDto,
  platformScope: boolean,
): ListAuditLogsRequest {
  return {
    page: toPageRequest(query),
    action: toProtoAuditAction(query.action),
    userId: query.userId ?? '',
    resourceType: toProtoAuditResourceType(query.resourceType),
    resourceId: query.resourceId ?? '',
    from: toProtoTimestamp(query.from ?? null),
    to: toProtoTimestamp(query.to ?? null),
    platformScope,
  };
}
