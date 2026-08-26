import { NoEmoji } from '../../../../common/decorators/no-emoji.decorator';
import {
  MAX_ADMIN_REASON_LENGTH,
  MAX_ALLOWED_EMAIL_DOMAINS,
  MAX_ORGANIZATION_DOMAIN_LENGTH,
  MAX_ORGANIZATION_NAME_LENGTH,
  MAX_ORGANIZATION_SLUG_LENGTH,
  ORGANIZATION_DOMAIN_PATTERN,
  ORGANIZATION_SLUG_PATTERN,
} from '../../../../common/config/dto.config';
import { Type, Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  lowerIfString,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_DOCUMENT_BYTES,
  trimIfString,
} from '@synapsedesk/common';

/**
 * Profile only. Quotas (`maxAgentSeats`, storage, token budget) and `status`
 * are deliberately absent: a tenant raising its own seat limit or un-freezing
 * itself is the billing model and the suspension mechanism gone. Both live
 * behind `/platform/*`.
 */
export class UpdateOrganizationDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(MAX_ORGANIZATION_NAME_LENGTH)
  @Transform(trimIfString)
  @NoEmoji()
  readonly name?: string;

  /**
   * Appears in URLs, so changing it breaks every existing link. Treated as a
   * rename with consequences rather than a cosmetic edit — the service rejects
   * a collision with 409 rather than silently suffixing it.
   */
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(MAX_ORGANIZATION_SLUG_LENGTH)
  @Matches(ORGANIZATION_SLUG_PATTERN)
  // **Lowercased BEFORE the pattern, and that is a compatibility fix.**
  // class-transformer runs ahead of class-validator regardless of decorator
  // order, so `ACME-CORP` becomes `acme-corp` and passes. Without it the
  // pattern turned a request that used to succeed into a 400: the service has
  // done `.trim().toLowerCase()` on this field all along
  // (`platform.service.ts`), so uppercase was accepted and canonicalized, not
  // rejected. Moving the refusal earlier is right for `acme corp` and
  // `acme/corp`, which nothing ever fixed — it is not right for case.
  @Transform(lowerIfString)
  @Transform(trimIfString)
  readonly slug?: string;

  /** Empty string clears it. Globally unique across tenants. */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_ORGANIZATION_DOMAIN_LENGTH)
  @Matches(ORGANIZATION_DOMAIN_PATTERN)
  // Lowercased first, same reason as `slug`: auth-service already does it, so
  // refusing `ACME.COM` would break a request that used to work.
  @Transform(lowerIfString)
  @Transform(trimIfString)
  readonly domain?: string;
}

/**
 * The two security-relevant tenant settings.
 *
 * `allowedEmailDomains` decides WHO CAN AUTO-JOIN at registration, so it is not
 * a preference — it is an access-control list with a friendlier name.
 */
export class UpdateOrganizationSettingsDto {
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  readonly enforceTwoFactor?: boolean;

  /**
   * REPLACE semantics when present, untouched when absent.
   *
   * The gateway can tell the two apart (`undefined` vs `[]`) but protobuf
   * cannot, which is why the client sets an explicit replace flag on the wire.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ALLOWED_EMAIL_DOMAINS)
  @IsString({ each: true })
  // NO default, and the `?` stays. `organizations.service.ts` derives
  // `replaceAllowedEmailDomains` from `!== undefined`, so a default of `[]`
  // would set that flag on EVERY settings update and wipe the tenant's
  // self-signup allowlist -- a security setting -- whenever the field is
  // simply not being edited.
  //
  // And NO `@Matches`, unlike `domain` above — the symmetry is wrong here.
  // `organizations.service.ts` warns rather than rejects (`normalizeDomains`
  // populates `publicDomainWarnings`), because putting `gmail.com` on a
  // self-signup allowlist is a questionable decision, not a malformed request.
  // A pattern here would turn that considered warning into a 400. Matching is
  // exact at both readers, so a malformed entry cannot over-match — it simply
  // never matches anything.
  readonly allowedEmailDomains?: string[];

  /**
   * The largest document this workspace will accept, at or below the platform
   * ceiling. `null` clears it; an absent key leaves it unchanged.
   */
  // Three states have to survive this DTO and `@IsOptional` is the only
  // decorator that lets them: it skips validation for BOTH absences, and the
  // distinction is recovered in `organizations.service.ts`, which reads
  // `=== null` off the instance. `@IsNullable` is for RESPONSE DTOs — it skips
  // only `undefined`, so `null` reaches `@IsInt()` and 400s.
  // `@IsPresentButNullable` has the opposite half of the problem.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  // REFUSES rather than clamps. A value above the platform constant is a
  // self-service entitlement grant — the outcome the layering rule exists to
  // prevent — and a clamp would accept a request whose intent it did not
  // honour, with no way for the caller to learn its 500 MB became 100.
  @Max(MAX_DOCUMENT_BYTES)
  readonly maxDocumentBytesOverride?: number | null;

  /** See {@link UpdateOrganizationSettingsDto.maxDocumentBytesOverride}. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_ATTACHMENT_BYTES)
  readonly maxAttachmentBytesOverride?: number | null;

  /** See {@link UpdateOrganizationSettingsDto.maxDocumentBytesOverride}. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_ATTACHMENTS_PER_MESSAGE)
  readonly maxAttachmentsPerMessageOverride?: number | null;
}

export class DeleteOrganizationDto {
  /**
   * Required. Offboarding is finalized by a Super Admin who was not in the
   * room, and "why did Acme leave?" is the first thing they will ask.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_ADMIN_REASON_LENGTH)
  readonly reason!: string;
}
