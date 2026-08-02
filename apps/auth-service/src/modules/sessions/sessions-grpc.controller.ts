import { Controller } from '@nestjs/common';
import type { Metadata } from '@grpc/grpc-js';
import {
  ListSessionsRequest,
  ListSessionsResponse,
  ListUserSessionsRequest,
  RevokeSessionResponse,
  RevokeTrustResponse,
  RevokeUserSessionsRequest,
  RevokeUserSessionsResponse,
  SessionIdRequest,
  SessionServiceController,
  SessionServiceControllerMethods,
  unpackCallerContext,
} from '@synapsedesk/grpc-proto';
import { SessionsService } from './sessions.service';

@Controller()
@SessionServiceControllerMethods()
export class SessionsGrpcController implements SessionServiceController {
  constructor(private readonly sessionsService: SessionsService) {}

  listSessions(
    request: ListSessionsRequest,
    metadata?: Metadata,
  ): Promise<ListSessionsResponse> {
    return this.sessionsService.listSessions(
      request,
      unpackCallerContext(metadata),
    );
  }

  revokeSession(
    request: SessionIdRequest,
    metadata?: Metadata,
  ): Promise<RevokeSessionResponse> {
    return this.sessionsService.revokeSession(
      request,
      unpackCallerContext(metadata),
    );
  }

  revokeSessionTrust(
    request: SessionIdRequest,
    metadata?: Metadata,
  ): Promise<RevokeTrustResponse> {
    return this.sessionsService.revokeSessionTrust(
      request,
      unpackCallerContext(metadata),
    );
  }

  revokeAllTrust(
    _request: unknown,
    metadata?: Metadata,
  ): Promise<RevokeTrustResponse> {
    return this.sessionsService.revokeAllTrust(unpackCallerContext(metadata));
  }

  listUserSessions(
    request: ListUserSessionsRequest,
    metadata?: Metadata,
  ): Promise<ListSessionsResponse> {
    return this.sessionsService.listUserSessions(
      request,
      unpackCallerContext(metadata),
    );
  }

  revokeUserSessions(
    request: RevokeUserSessionsRequest,
    metadata?: Metadata,
  ): Promise<RevokeUserSessionsResponse> {
    return this.sessionsService.revokeUserSessions(
      request,
      unpackCallerContext(metadata),
    );
  }
}
