import {
  AcceptInvitationResponse,
  CreateInvitationsResponse,
  fromProtoInvitationStatus,
  fromProtoTimestamp,
  type InvitationResponse,
  InviteUserInput,
  ListInvitationsRequest,
  ListInvitationsResponse,
  PreviewInvitationResponse,
  PreviewInvitationsResponse,
  requireField,
  requireProtoTimestamp,
  toPageRequest,
  toProtoInvitationStatus,
} from '@synapsedesk/grpc-proto';
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import { toPaginationMetaDataResponseDto } from '../../common/mappers/pagination.mapper';
import { toUserResponseDto } from '../users/user.mapper';
import { UserResponseDto } from '../users/dto/rest/user-response.dto';
import {
  InviteUserDto,
  ListInvitationsQueryDto,
} from './dto/rest/invitation.dto';
import {
  CreateInvitationsResponseDto,
  InvitationResponseDto,
  PreviewInvitationResponseDto,
  PreviewInvitationsResponseDto,
} from './dto/rest/invitation-response.dto';
import { InvitationStatus } from '@synapsedesk/common';

/** Accepting signs the invitee in, so the controller needs the raw tokens. */
export type AcceptInvitationResult = {
  user: UserResponseDto;
  accessToken: string;
  refreshToken: string;
  skipped: string[];
};

/**
 * Wire -> REST boundary for an invitation.
 *
 * A mapper MODULE rather than a private method on the gRPC client, matching
 * `user.mapper.ts`. Two reasons it earns its own file: the conversion is a pure
 * function of its input and is worth testing without standing up a Nest
 * provider, and both the client and any future consumer (a resolver, a
 * WebSocket payload) need it — a private method would force one of them to
 * reimplement it.
 */
export function toInvitationResponseDto(
  invitation: InvitationResponse,
): InvitationResponseDto {
  return {
    id: invitation.id,
    email: invitation.email,
    // The proto enum is numeric; the REST contract exposes the readable domain
    // value. `?? PENDING` covers UNSPECIFIED, which the service never emits.
    status:
      fromProtoInvitationStatus(invitation.status) ?? InvitationStatus.PENDING,
    roleIds: invitation.roleIds,
    departmentIds: invitation.departmentIds,
    // protobuf has no null; unset arrives as undefined and REST commits to null.
    primaryDepartmentId: invitation.primaryDepartmentId ?? null,
    invitedByName: invitation.invitedByName ?? null,
    resentCount: invitation.resentCount,
    // requireProtoTimestamp, not fromProtoTimestamp: these are non-optional in the proto,
    // so a missing value is a contract violation rather than something to paper
    // over with a fallback date.
    lastSentAt: requireProtoTimestamp(invitation.lastSentAt, 'lastSentAt'),
    expiresAt: requireProtoTimestamp(invitation.expiresAt, 'expiresAt'),
    createdAt: requireProtoTimestamp(invitation.createdAt, 'createdAt'),
  };
}

/** Builds the wire shape for one drafted invitation. */
export function toInviteUserInput(draft: InviteUserDto): InviteUserInput {
  return {
    email: draft.email,
    roleIds: draft.roleIds,
    departmentIds: draft.departmentIds,
    primaryDepartmentId: draft.primaryDepartmentId,
  };
}

/** Converts a `CreateInvitationsResponse` off the wire into its REST DTO. */
export function toCreateInvitationsResponseDto(
  response: CreateInvitationsResponse,
): CreateInvitationsResponseDto {
  return {
    created: response.created.map(toInvitationResponseDto),
    failed: response.failed,
    batchId: response.batchId ?? null,
  };
}

/** Converts a `ListInvitationsResponse` into the paginated REST envelope. */
export function toInvitationPageDto(
  response: ListInvitationsResponse,
): PaginationResponseDto<InvitationResponseDto> {
  return {
    items: response.items.map(toInvitationResponseDto),
    meta: toPaginationMetaDataResponseDto(response.meta),
  };
}

/** Converts a `PreviewInvitationResponse` off the wire into its REST DTO. */
export function toPreviewInvitationResponseDto(
  response: PreviewInvitationResponse,
): PreviewInvitationResponseDto {
  return {
    valid: response.valid,
    organizationName: response.organizationName ?? null,
    inviterName: response.inviterName ?? null,
    email: response.email ?? null,
    roleNames: response.roleNames,
    expiresAt: fromProtoTimestamp(response.expiresAt) ?? null,
  };
}

/**
 * Splits an `AcceptInvitationResponse` into the user shape and the tokens.
 *
 * Not a `*Dto`: the tokens are set as cookies and must never reach a body.
 *
 * @throws Error if the response carries no user, which the proto requires.
 */
export function toAcceptInvitationResult(
  response: AcceptInvitationResponse,
): AcceptInvitationResult {
  return {
    user: toUserResponseDto(requireField(response.user, 'user')),
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
    skipped: response.skipped,
  };
}

/** Converts a `PreviewInvitationsResponse` off the wire into its REST DTO. */
export function toPreviewInvitationsResponseDto(
  response: PreviewInvitationsResponse,
): PreviewInvitationsResponseDto {
  return {
    rows: response.rows.map((row) => ({
      email: row.email,
      ok: row.ok,
      reason: row.reason ?? null,
      unknownRoleIds: row.unknownRoleIds,
      unknownDepartmentIds: row.unknownDepartmentIds,
    })),
    seatsInUse: response.seatsInUse,
    maxAgentSeats: response.maxAgentSeats,
    seatOverrun: response.seatOverrun,
  };
}

/** Builds a `ListInvitationsRequest` from the REST query. */
export function toListInvitationsRequest(
  organizationId: string,
  query: ListInvitationsQueryDto,
): ListInvitationsRequest {
  return {
    organizationId,
    status: query.status ? toProtoInvitationStatus(query.status) : undefined,
    page: toPageRequest(query),
  };
}
