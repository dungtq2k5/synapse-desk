import { NoEmoji } from '../../../../common/decorators/no-emoji.decorator';
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
  MIN_PASSWORD_LENGTH,
  type InvitationSortableField,
} from '@synapsedesk/common';
import { SearchPaginationDto } from '../../../../common/dto/rest/search-pagination.dto';
import {
  MAX_DEVICE_NAME_LENGTH,
  MAX_EMAIL_ADDRESS_LENGTH,
  MAX_INVITATIONS_PER_BATCH,
  MAX_PREVIEW_ID_LENGTH,
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
  @ApiPropertyOptional()
  readonly roleIds: string[] = [];

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  @ApiPropertyOptional()
  readonly departmentIds: string[] = [];

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
  // `@ApiPropertyOptional()` is required here: the Swagger plugin derives
  // `required` from TYPESCRIPT optionality, so a defaulted non-optional field
  // is documented as mandatory and a generated client refuses to omit it.
  @ApiPropertyOptional()
  readonly sortBy: InvitationSortableField = DEFAULT_SEARCH.SORT_BY;
}

export class AcceptInvitationDto {
  @IsString()
  readonly token!: string;

  @IsString()
  @MinLength(1)
  @NoEmoji()
  readonly fullName!: string;

  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH)
  readonly password!: string;

  /**
   * Labels the session this call creates, in the user's active-device list.
   *
   * Optional: the client sends what it can identify itself as, and a session
   * with no label is still a session.
   */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_DEVICE_NAME_LENGTH)
  // Deliberately WITHOUT `@NoEmoji`: an emoji here is cosmetic, since unlike
  // `fullName` this is not a tenant-wide identifier other people read out of a
  // list they must trust.
  //
  // The class that WOULD matter is a different one, and an emoji rule does not
  // touch it. This is display text in a security surface — the active-session
  // list a user scans to spot an intruder — where bidi and format controls
  // (U+202E, zero-width characters) let one session's label rearrange or
  // impersonate another's on screen. That rule belongs on every user-supplied
  // string landing in such a list, `fullName` included, so it is a separate
  // task rather than a decorator added here.
  readonly deviceName?: string;
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
  @MaxLength(MAX_EMAIL_ADDRESS_LENGTH)
  readonly email!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(MAX_PREVIEW_ID_LENGTH, { each: true })
  @ApiPropertyOptional()
  readonly roleIds: string[] = [];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(MAX_PREVIEW_ID_LENGTH, { each: true })
  @ApiPropertyOptional()
  readonly departmentIds: string[] = [];

  @IsOptional()
  @IsString()
  @MaxLength(MAX_PREVIEW_ID_LENGTH)
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
