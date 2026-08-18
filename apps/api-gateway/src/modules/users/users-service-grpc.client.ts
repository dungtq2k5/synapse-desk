import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  AUTH_GRPC_CLIENT,
  USER_SERVICE_NAME,
  UserServiceClient,
  ConfirmAvatarUploadRequest,
  CreateUserRequest,
  CreateUserResponse,
  DeleteUserResponse,
  CurrentUserResponse,
  GetUserPermissionsResponse,
  ListUsersRequest,
  ListUsersResponse,
  LockUserRequest,
  LockUserResponse,
  PresignAvatarUploadRequest,
  PresignAvatarUploadResponse,
  ResetUserTwoFactorResponse,
  SetUserDepartmentsRequest,
  SetUserRolesRequest,
  UpdateOwnProfileRequest,
  UpdateUserRequest,
  UserResponse,
  UserSummaryResponse,
} from '@synapsedesk/grpc-proto';
import { RequestContext, RequestOrigin } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';

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

  getCurrentUser(
    userId: string,
    origin: RequestOrigin,
  ): Promise<CurrentUserResponse> {
    return this.call(
      (metadata) => this.userGrpcService.getCurrentUser({ userId }, metadata),
      origin,
    );
  }

  updateOwnProfile(
    request: UpdateOwnProfileRequest,
    context: RequestContext,
  ): Promise<UserResponse> {
    return this.call(
      (metadata) => this.userGrpcService.updateOwnProfile(request, metadata),
      context,
    );
  }

  // ------------------------------------------------------------- avatars

  presignAvatar(
    request: PresignAvatarUploadRequest,
    context: RequestContext,
  ): Promise<PresignAvatarUploadResponse> {
    return this.call(
      (metadata) => this.userGrpcService.presignAvatarUpload(request, metadata),
      context,
    );
  }

  confirmAvatar(
    request: ConfirmAvatarUploadRequest,
    context: RequestContext,
  ): Promise<UserResponse> {
    return this.call(
      (metadata) => this.userGrpcService.confirmAvatarUpload(request, metadata),
      context,
    );
  }

  deleteAvatar(context: RequestContext): Promise<UserResponse> {
    return this.call(
      (metadata) => this.userGrpcService.deleteAvatar({}, metadata),
      context,
    );
  }

  list(
    request: ListUsersRequest,
    context: RequestContext,
  ): Promise<ListUsersResponse> {
    return this.call(
      (metadata) => this.userGrpcService.listUsers(request, metadata),
      context,
    );
  }

  get(id: string, context: RequestContext): Promise<UserSummaryResponse> {
    return this.call(
      (metadata) => this.userGrpcService.getUser({ id }, metadata),
      context,
    );
  }

  getPermissions(
    id: string,
    context: RequestContext,
  ): Promise<GetUserPermissionsResponse> {
    return this.call(
      (metadata) => this.userGrpcService.getUserPermissions({ id }, metadata),
      context,
    );
  }

  create(
    request: CreateUserRequest,
    context: RequestContext,
  ): Promise<CreateUserResponse> {
    return this.call(
      (metadata) => this.userGrpcService.createUser(request, metadata),
      context,
    );
  }

  update(
    request: UpdateUserRequest,
    context: RequestContext,
  ): Promise<UserSummaryResponse> {
    return this.call(
      (metadata) => this.userGrpcService.updateUser(request, metadata),
      context,
    );
  }

  remove(id: string, context: RequestContext): Promise<DeleteUserResponse> {
    return this.call(
      (metadata) => this.userGrpcService.deleteUser({ id }, metadata),
      context,
    );
  }

  restore(id: string, context: RequestContext): Promise<UserSummaryResponse> {
    return this.call(
      (metadata) => this.userGrpcService.restoreUser({ id }, metadata),
      context,
    );
  }

  lock(
    request: LockUserRequest,
    context: RequestContext,
  ): Promise<LockUserResponse> {
    return this.call(
      (metadata) => this.userGrpcService.lockUser(request, metadata),
      context,
    );
  }

  async unlock(id: string, context: RequestContext): Promise<void> {
    await this.call(
      (metadata) => this.userGrpcService.unlockUser({ id }, metadata),
      context,
    );
  }

  resetTwoFactor(
    id: string,
    context: RequestContext,
  ): Promise<ResetUserTwoFactorResponse> {
    return this.call(
      (metadata) => this.userGrpcService.resetUserTwoFactor({ id }, metadata),
      context,
    );
  }

  setRoles(
    request: SetUserRolesRequest,
    context: RequestContext,
  ): Promise<UserSummaryResponse> {
    return this.call(
      (metadata) => this.userGrpcService.setUserRoles(request, metadata),
      context,
    );
  }

  setDepartments(
    request: SetUserDepartmentsRequest,
    context: RequestContext,
  ): Promise<UserSummaryResponse> {
    return this.call(
      (metadata) => this.userGrpcService.setUserDepartments(request, metadata),
      context,
    );
  }
}
