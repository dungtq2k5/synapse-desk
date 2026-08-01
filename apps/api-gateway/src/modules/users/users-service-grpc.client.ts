import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  AUTH_GRPC_CLIENT,
  USER_SERVICE_NAME,
  UserServiceClient,
} from '@synapsedesk/grpc-proto';
import { PermissionCode, RequestOrigin } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';
import { CurrentUserResponseDto } from '../users/dto/rest/current-user-response.dto';
import { toUserResponseDto } from './user.mapper';

@Injectable()
export class UserServiceGrpcClient
  extends BaseGrpcClient
  implements OnModuleInit
{
  protected readonly serviceName = 'auth-service';

  private userGrpcService!: UserServiceClient;

  constructor(@Inject(AUTH_GRPC_CLIENT) private readonly client: ClientGrpc) {
    super();
  }

  onModuleInit() {
    this.userGrpcService =
      this.client.getService<UserServiceClient>(USER_SERVICE_NAME);
  }

  async getCurrentUser(
    userId: string,
    origin: RequestOrigin,
  ): Promise<CurrentUserResponseDto> {
    const response = await this.call(
      (metadata) => this.userGrpcService.getCurrentUser({ userId }, metadata),
      origin,
    );

    return {
      user: toUserResponseDto(response.user!),
      // The proto declares `repeated string`; narrowing it to PermissionCode[]
      // is this boundary's job, and the codes originate from our own seeded
      // catalogue rather than from user input.
      permissionCodes: response.permissionCodes as PermissionCode[],
      departmentIds: response.departmentIds,
    };
  }
}
