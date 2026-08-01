import {
  fromProtoInvitationStatus,
  requireTimestamp,
  type InvitationResponse,
} from '@synapsedesk/grpc-proto';
import { InvitationStatus } from '@synapsedesk/common';
import { InvitationResponseDto } from './dto/rest/invitation.dto';

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
export function toInvitationDto(
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
    // requireTimestamp, not fromTimestamp: these are non-optional in the proto,
    // so a missing value is a contract violation rather than something to paper
    // over with a fallback date.
    lastSentAt: requireTimestamp(invitation.lastSentAt, 'lastSentAt'),
    expiresAt: requireTimestamp(invitation.expiresAt, 'expiresAt'),
    createdAt: requireTimestamp(invitation.createdAt, 'createdAt'),
  };
}
