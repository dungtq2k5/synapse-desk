import { Injectable } from '@nestjs/common';
import { RequestContext } from '@synapsedesk/common';
import { SessionsGrpcClient } from './sessions-grpc.client';
import { toSessionResponseDtos } from './session.mapper';
import {
  RevokeCountResponseDto,
  RevokeTrustResponseDto,
  SessionResponseDto,
} from './dto/rest/session-response.dto';

/** The gateway's session surface. Returns REST DTOs; the wire stays in the client. */
/**
 * Whether the revoked family was the caller's own, so the controller knows
 * whether to clear cookies.
 *
 * Not a `…ResponseDto`, deliberately: it is never serialized. The controller
 * reads `wasCurrent` to decide about cookies and returns its own body, so
 * naming it for a response would promise a client something it never receives.
 */
export type RevokeSessionResult = {
  wasCurrent: boolean;
  revokedCount: number;
};

@Injectable()
export class SessionsService {
  constructor(private readonly sessionsGrpcClient: SessionsGrpcClient) {}

  /** @param refreshToken Marks the caller's own session as current, when present. */
  async list(
    refreshToken: string | undefined,
    context: RequestContext,
  ): Promise<SessionResponseDto[]> {
    return toSessionResponseDtos(
      await this.sessionsGrpcClient.list(refreshToken, context),
    );
  }

  revoke(
    sessionId: string,
    refreshToken: string | undefined,
    context: RequestContext,
  ): Promise<RevokeSessionResult> {
    return this.sessionsGrpcClient.revoke(sessionId, refreshToken, context);
  }

  revokeTrust(
    sessionId: string,
    context: RequestContext,
  ): Promise<RevokeTrustResponseDto> {
    return this.sessionsGrpcClient.revokeTrust(sessionId, context);
  }

  revokeAllTrust(context: RequestContext): Promise<RevokeTrustResponseDto> {
    return this.sessionsGrpcClient.revokeAllTrust(context);
  }

  async listForUser(
    userId: string,
    context: RequestContext,
  ): Promise<SessionResponseDto[]> {
    return toSessionResponseDtos(
      await this.sessionsGrpcClient.listForUser(userId, context),
    );
  }

  revokeForUser(
    userId: string,
    context: RequestContext,
  ): Promise<RevokeCountResponseDto> {
    return this.sessionsGrpcClient.revokeForUser(userId, context);
  }
}
