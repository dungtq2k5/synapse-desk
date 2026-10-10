import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  AUTH_GRPC_CLIENT,
  ListSessionsResponse,
  RevokeSessionResponse,
  RevokeTrustResponse,
  RevokeUserSessionsResponse,
  SESSION_SERVICE_NAME,
  SessionServiceClient,
} from '@synapsedesk/grpc-proto';
import { RequestContext } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';

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

  list(
    refreshToken: string | undefined,
    context: RequestContext,
  ): Promise<ListSessionsResponse> {
    return this.call(
      (metadata) =>
        this.sessionGrpcService.listSessions({ refreshToken }, metadata),
      context,
    );
  }

  revoke(
    sessionId: string,
    refreshToken: string | undefined,
    context: RequestContext,
  ): Promise<RevokeSessionResponse> {
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
  ): Promise<RevokeTrustResponse> {
    return this.call(
      (metadata) =>
        this.sessionGrpcService.revokeSessionTrust({ sessionId }, metadata),
      context,
    );
  }

  revokeAllTrust(context: RequestContext): Promise<RevokeTrustResponse> {
    return this.call(
      (metadata) => this.sessionGrpcService.revokeAllTrust({}, metadata),
      context,
    );
  }

  listForUser(
    userId: string,
    context: RequestContext,
  ): Promise<ListSessionsResponse> {
    return this.call(
      (metadata) =>
        this.sessionGrpcService.listUserSessions({ userId }, metadata),
      context,
    );
  }

  revokeForUser(
    userId: string,
    context: RequestContext,
  ): Promise<RevokeUserSessionsResponse> {
    return this.call(
      (metadata) =>
        this.sessionGrpcService.revokeUserSessions({ userId }, metadata),
      context,
    );
  }
}
