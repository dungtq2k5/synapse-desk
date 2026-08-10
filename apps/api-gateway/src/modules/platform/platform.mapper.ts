import {
  PlatformOrganizationResponse,
  fromProtoTimestamp,
} from '@synapsedesk/grpc-proto';
import { PlatformOrganizationResponseDto } from './dto/rest/platform.dto';
import { toOrganizationResponseDto } from '../organizations/organization.mapper';

export function toPlatformOrganizationResponseDto(
  row: PlatformOrganizationResponse,
): PlatformOrganizationResponseDto {
  return {
    organization: toOrganizationResponseDto(row.organization!),
    userCount: row.userCount,
    pendingInvitationCount: row.pendingInvitationCount,
    departmentCount: row.departmentCount,
    deletedAt: fromProtoTimestamp(row.deletedAt) ?? null,
  };
}
