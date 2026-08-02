import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  AUTH_GRPC_CLIENT,
  SESSION_SERVICE_NAME,
  SessionServiceClient,
} from '@synapsedesk/grpc-proto';
import { RequestContext } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';
import {
  RevokeCountResponseDto,
  RevokeTrustResponseDto,
  SessionResponseDto,
} from './dto/rest/session.dto';
import { toSessionDto } from './session.mapper';

/** Whether the revoked family was the caller's own, so the controller knows
 * whether to clear cookies. */
export type RevokeSessionResult = {
  wasCurrent: boolean;
  revokedCount: number;
};

@Injectable()
export class SessionsGrpcClient extends BaseGrpcClient implements OnModuleInit {
  protected readonly serviceName = 'auth-service';

  private sessionGrpcService!: SessionServiceClient;

  constructor(@Inject(AUTH_GRPC_CLIENT) private readonly client: ClientGrpc) {
    super();
  }

  onModuleInit() {
    this.sessionGrpcService =
      this.client.getService<SessionServiceClient>(SESSION_SERVICE_NAME);
  }

  async list(
    refreshToken: string | undefined,
    context: RequestContext,
  ): Promise<SessionResponseDto[]> {
    const response = await this.call(
      (metadata) =>
        this.sessionGrpcService.listSessions({ refreshToken }, metadata),
      context,
    );

    return response.items.map(toSessionDto);
  }

  revoke(
    sessionId: string,
    refreshToken: string | undefined,
    context: RequestContext,
  ): Promise<RevokeSessionResult> {
    return this.call(
      (metadata) =>
        this.sessionGrpcService.revokeSession(
          { sessionId, refreshToken },
          metadata,
        ),
      context,
    );
  }

  revokeTrust(
    sessionId: string,
    context: RequestContext,
  ): Promise<RevokeTrustResponseDto> {
    return this.call(
      (metadata) =>
        this.sessionGrpcService.revokeSessionTrust({ sessionId }, metadata),
      context,
    );
  }

  revokeAllTrust(context: RequestContext): Promise<RevokeTrustResponseDto> {
    return this.call(
      (metadata) => this.sessionGrpcService.revokeAllTrust({}, metadata),
      context,
    );
  }

  async listForUser(
    userId: string,
    context: RequestContext,
  ): Promise<SessionResponseDto[]> {
    const response = await this.call(
      (metadata) =>
        this.sessionGrpcService.listUserSessions({ userId }, metadata),
      context,
    );

    return response.items.map(toSessionDto);
  }

  revokeForUser(
    userId: string,
    context: RequestContext,
  ): Promise<RevokeCountResponseDto> {
    return this.call(
      (metadata) =>
        this.sessionGrpcService.revokeUserSessions({ userId }, metadata),
      context,
    );
  }
}
