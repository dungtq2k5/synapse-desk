import { Type } from 'class-transformer';
import { OmitType, ApiPropertyOptional } from '@nestjs/swagger';
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
import {
  DEFAULT_SEARCH,
  INVITATION_SORTABLE_FIELDS,
  InvitationStatus,
  type InvitationSortableField,
} from '@synapsedesk/common';
import { SearchPaginationDto } from '../../../../common/dto/rest/search-pagination.dto';
import {
  MAX_DEVICE_NAME_LENGTH,
  MAX_INVITATIONS_PER_BATCH,
} from '../../../../common/config/dto.config';

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

export class ListInvitationsQueryDto extends OmitType(SearchPaginationDto, [
  'sortBy',
] as const) {
  @IsOptional()
  @IsIn(Object.values(InvitationStatus))
  readonly status?: InvitationStatus;

  @IsOptional()
  @IsString()
  @IsIn(INVITATION_SORTABLE_FIELDS)
  /**
   * Optional in the API and, without this, REQUIRED in the docs
   *
   * The plugin derives `required` from TYPESCRIPT optionality, not from
   * `@IsOptional()`. A field declared `page: number = 1` is non-optional to the
   * compiler even though the validator lets a caller omit it, so the generated
   * spec demanded it — and a generated client would refuse to send a request
   * without one.
   */
  @ApiPropertyOptional()
  readonly sortBy: InvitationSortableField = DEFAULT_SEARCH.SORT_BY;
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

/**
 * A row in a DRY RUN. Deliberately looser than `InviteUserDto`.
 *
 * `@IsEmail()` and `@IsUUID()` are absent ON PURPOSE. Inheriting them (as this
 * class first did) makes the endpoint reject the whole batch at the edge the
 * moment one row has a typo — which is precisely the batch a user reaches for
 * the preview to inspect. The service classifies each row instead, so a
 * malformed address comes back as `ok: false, reason: 'Not a valid email
 * address'` beside the 199 good ones.
 *
 * Lengths are still bounded: the point is to accept bad DATA, not unbounded
 * input.
 */
export class PreviewInviteUserDto {
  @IsString()
  @MaxLength(320)
  readonly email!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  readonly roleIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  readonly departmentIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  readonly primaryDepartmentId?: string;
}

export class PreviewInvitationsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_INVITATIONS_PER_BATCH)
  @ValidateNested({ each: true })
  @Type(() => PreviewInviteUserDto)
  readonly invitations!: PreviewInviteUserDto[];
}

export class InvitationPreviewRowDto {
  readonly email!: string;
  readonly ok!: boolean;
  readonly reason!: string | null;
  /** Reported even on an OK row: these are skipped at redemption, not fatal. */
  readonly unknownRoleIds!: string[];
  readonly unknownDepartmentIds!: string[];
}

export class PreviewInvitationsResponseDto {
  readonly rows!: InvitationPreviewRowDto[];
  readonly seatsInUse!: number;
  readonly maxAgentSeats!: number;
  /** Non-zero means the batch would be partially rejected at commit time. */
  readonly seatOverrun!: number;
}
