import { Controller } from '@nestjs/common';
import type { Metadata } from '@grpc/grpc-js';
import {
  CreateUserRequest,
  CreateUserResponse,
  CurrentUserResponse,
  DeleteUserResponse,
  GetCurrentUserRequest,
  GetUserPermissionsResponse,
  ListPermissionHoldersRequest,
  ListPermissionHoldersResponse,
  ListUsersByIdsRequest,
  ResolveInboundSenderRequest,
  ResolveInboundSenderResponse,
  ListUsersByIdsResponse,
  ListUsersRequest,
  ListUsersResponse,
  LockUserRequest,
  LockUserResponse,
  ResetUserTwoFactorResponse,
  SetUserDepartmentsRequest,
  SetUserRolesRequest,
  UnlockUserResponse,
  unpackCallerContext,
  UpdateOwnProfileRequest,
  UpdateUserRequest,
  UserIdRequest,
  ConfirmAvatarUploadRequest,
  DeleteAvatarRequest,
  PresignAvatarUploadRequest,
  PresignAvatarUploadResponse,
  UserResponse,
  UserServiceController,
  UserServiceControllerMethods,
  UserSummaryResponse,
} from '@synapsedesk/grpc-proto';
import { UsersService } from './users.service';

@Controller()
@UserServiceControllerMethods()
export class UsersGrpcController implements UserServiceController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * The only method taking a user id in the REQUEST rather than from metadata.
   *
   * It is called by the gateway during token verification, before a caller
   * context exists to unpack — the id comes from the JWT the gateway has just
   * validated.
   */
  getCurrentUser(request: GetCurrentUserRequest): Promise<CurrentUserResponse> {
    return this.usersService.getCurrentUser(request.userId);
  }

  updateOwnProfile(
    request: UpdateOwnProfileRequest,
    metadata?: Metadata,
  ): Promise<UserResponse> {
    return this.usersService.updateOwnProfile(
      request,
      unpackCallerContext(metadata),
    );
  }

  listUsers(
    request: ListUsersRequest,
    metadata?: Metadata,
  ): Promise<ListUsersResponse> {
    return this.usersService.listUsers(request, unpackCallerContext(metadata));
  }

  getUser(
    request: UserIdRequest,
    metadata?: Metadata,
  ): Promise<UserSummaryResponse> {
    return this.usersService.getUser(request, unpackCallerContext(metadata));
  }

  getUserPermissions(
    request: UserIdRequest,
    metadata?: Metadata,
  ): Promise<GetUserPermissionsResponse> {
    return this.usersService.getUserPermissions(
      request,
      unpackCallerContext(metadata),
    );
  }

  /**
   * Service-to-service only — notification-service resolving an audience.
   *
   * Reads no caller context: the tenant is a FIELD of the request because the
   * caller is a background consumer with no user. It is never routed by the
   * gateway, which is what keeps a tenant's user list and addresses out of
   * reach of any client.
   */
  listPermissionHolders(
    request: ListPermissionHoldersRequest,
  ): Promise<ListPermissionHoldersResponse> {
    return this.usersService.listPermissionHolders(request);
  }

  /** Takes the tenant, so it cannot create one — see the service. */
  resolveInboundSender(
    request: ResolveInboundSenderRequest,
  ): Promise<ResolveInboundSenderResponse> {
    return this.usersService.resolveInboundSender(request);
  }

  /** Service-to-service only, like the one above. */
  listUsersByIds(
    request: ListUsersByIdsRequest,
  ): Promise<ListUsersByIdsResponse> {
    return this.usersService.listUsersByIds(request);
  }

  createUser(
    request: CreateUserRequest,
    metadata?: Metadata,
  ): Promise<CreateUserResponse> {
    return this.usersService.createUser(request, unpackCallerContext(metadata));
  }

  updateUser(
    request: UpdateUserRequest,
    metadata?: Metadata,
  ): Promise<UserSummaryResponse> {
    return this.usersService.updateUser(request, unpackCallerContext(metadata));
  }

  deleteUser(
    request: UserIdRequest,
    metadata?: Metadata,
  ): Promise<DeleteUserResponse> {
    return this.usersService.deleteUser(request, unpackCallerContext(metadata));
  }

  restoreUser(
    request: UserIdRequest,
    metadata?: Metadata,
  ): Promise<UserSummaryResponse> {
    return this.usersService.restoreUser(
      request,
      unpackCallerContext(metadata),
    );
  }

  lockUser(
    request: LockUserRequest,
    metadata?: Metadata,
  ): Promise<LockUserResponse> {
    return this.usersService.lockUser(request, unpackCallerContext(metadata));
  }

  unlockUser(
    request: UserIdRequest,
    metadata?: Metadata,
  ): Promise<UnlockUserResponse> {
    return this.usersService.unlockUser(request, unpackCallerContext(metadata));
  }

  resetUserTwoFactor(
    request: UserIdRequest,
    metadata?: Metadata,
  ): Promise<ResetUserTwoFactorResponse> {
    return this.usersService.resetUserTwoFactor(
      request,
      unpackCallerContext(metadata),
    );
  }

  setUserRoles(
    request: SetUserRolesRequest,
    metadata?: Metadata,
  ): Promise<UserSummaryResponse> {
    return this.usersService.setUserRoles(
      request,
      unpackCallerContext(metadata),
    );
  }

  setUserDepartments(
    request: SetUserDepartmentsRequest,
    metadata?: Metadata,
  ): Promise<UserSummaryResponse> {
    return this.usersService.setUserDepartments(
      request,
      unpackCallerContext(metadata),
    );
  }

  // ---------------------------------------------------------------- avatars

  presignAvatarUpload(
    request: PresignAvatarUploadRequest,
    metadata?: Metadata,
  ): Promise<PresignAvatarUploadResponse> {
    return this.usersService.presignAvatarUpload(
      request,
      unpackCallerContext(metadata),
    );
  }

  confirmAvatarUpload(
    request: ConfirmAvatarUploadRequest,
    metadata?: Metadata,
  ): Promise<UserResponse> {
    return this.usersService.confirmAvatarUpload(
      request,
      unpackCallerContext(metadata),
    );
  }

  /**
   * The request message is empty on purpose — the avatar being cleared is
   * always the CALLER'S. A `userId` field would be a way to clear somebody
   * else's.
   */
  deleteAvatar(
    _request: DeleteAvatarRequest,
    metadata?: Metadata,
  ): Promise<UserResponse> {
    return this.usersService.deleteAvatar(unpackCallerContext(metadata));
  }
}
