/** What the invitation routes return. */

import { InvitationStatus } from '@synapsedesk/common';

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
