/** What the platform (Super Admin) routes return. */

import { OrganizationResponseDto } from '../../../organizations/dto/rest/organization-response.dto';
import { UserResponseDto } from '../../../users/dto/rest/user-response.dto';

export class PlatformOrganizationResponseDto {
  readonly organization!: OrganizationResponseDto;
  readonly userCount!: number;
  readonly pendingInvitationCount!: number;
  readonly departmentCount!: number;
  readonly deletedAt!: Date | null;
}

export class PlatformUserResponseDto {
  readonly user!: UserResponseDto;
  /** Always present on a tenant user; null only for a platform Super Admin. */
  readonly organizationId!: string | null;
  readonly organizationName!: string | null;
  readonly roleNames!: string[];
  readonly deletedAt!: Date | null;
}

export class CreatePlatformOrganizationResponseDto {
  readonly organization!: PlatformOrganizationResponseDto;
  readonly admin!: UserResponseDto;
}

export class OffboardResponseDto {
  readonly revokedSessionCount!: number;
}

export class PlatformMetricsResponseDto {
  readonly totalOrganizations!: number;
  readonly organizationsByStatus!: Record<string, number>;
  readonly totalUsers!: number;
  readonly activeUsers!: number;
  readonly pendingInvitations!: number;
  readonly liveSessions!: number;
  readonly seatsAllocated!: number;
  readonly seatsInUse!: number;
  readonly generatedAt!: Date;
}
