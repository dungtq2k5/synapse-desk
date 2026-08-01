import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { InvitationStatus } from '@synapsedesk/common';
import { SearchPaginationBase } from '../../../../common/dto/base/search-pagination-base.dto';
import {
  MAX_DEVICE_NAME_LENGTH,
  MAX_INVITATIONS_PER_BATCH,
} from '../../../../common/config/app.config';

export class InviteUserDto {
  @IsEmail()
  readonly email!: string;

  /**
   * PROPOSALS, resolved at redemption rather than now. A role deleted during
   * the 7-day window is skipped and reported, never fatal.
   */
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  readonly roleIds?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  readonly departmentIds?: string[];

  @IsOptional()
  @IsUUID()
  readonly primaryDepartmentId?: string;
}

/**
 * Always a LIST, even for one invitation.
 *
 * A single shape for both means the 207 batch semantics apply uniformly instead
 * of the endpoint behaving differently depending on how many addresses were
 * sent.
 */
export class CreateInvitationsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_INVITATIONS_PER_BATCH)
  @ValidateNested({ each: true })
  @Type(() => InviteUserDto)
  readonly invitations!: InviteUserDto[];
}

export class ListInvitationsQueryDto extends SearchPaginationBase {
  @IsOptional()
  @IsIn(Object.values(InvitationStatus))
  readonly status?: InvitationStatus;
}

export class AcceptInvitationDto {
  @IsString()
  readonly token!: string;

  @IsString()
  @MinLength(1)
  readonly fullName!: string;

  @IsString()
  @MinLength(12)
  readonly password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_DEVICE_NAME_LENGTH)
  readonly deviceName?: string;
}

export class InvitationResponseDto {
  readonly id!: string;
  readonly email!: string;
  readonly status!: InvitationStatus;
  readonly roleIds!: string[];
  readonly departmentIds!: string[];
  readonly primaryDepartmentId!: string | null;
  readonly invitedByName!: string | null;
  readonly resentCount!: number;
  readonly lastSentAt!: Date;
  readonly expiresAt!: Date;
  readonly createdAt!: Date;
}

export class FailedInvitationDto {
  readonly email!: string;
  readonly reason!: string;
}

/**
 * Per-address outcomes. Surfaced as 207 when anything failed, so one typo in a
 * 200-row paste does not discard 199 good invitations.
 */
export class CreateInvitationsResponseDto {
  readonly created!: InvitationResponseDto[];
  readonly failed!: FailedInvitationDto[];
  readonly batchId!: string | null;
}

/** Public preview. `email` is masked; every unusable token reads `valid: false`. */
export class PreviewInvitationResponseDto {
  readonly valid!: boolean;
  readonly organizationName!: string | null;
  readonly inviterName!: string | null;
  readonly email!: string | null;
  readonly roleNames!: string[];
  readonly expiresAt!: Date | null;
}

export class AcceptInvitationResponseDto {
  readonly user!: unknown;
  /** Role/department ids that no longer resolved. Reported, never fatal. */
  readonly skipped!: string[];
}
