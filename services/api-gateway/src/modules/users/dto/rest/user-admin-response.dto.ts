/** What the user-administration routes return. */

import { UserResponseDto } from './user-response.dto';

export class UserSummaryResponseDto {
  readonly user!: UserResponseDto;
  readonly roleIds!: string[];
  readonly roleNames!: string[];
  readonly departmentIds!: string[];
  /** Non-null only on a deactivated account. */
  readonly deletedAt!: Date | null;
  readonly deletedByName!: string | null;
}

export class RevokedSessionCountResponseDto {
  readonly revokedSessionCount!: number;
}

export class UntrustedDeviceCountResponseDto {
  readonly untrustedDeviceCount!: number;
}

export class UserPermissionsResponseDto {
  readonly permissionCodes!: string[];
}
