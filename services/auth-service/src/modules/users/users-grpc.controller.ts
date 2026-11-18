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
import {
  requireSelf,
  requireSystem,
  requireTenant,
} from '@synapsedesk/nest-common';

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
  getCurrentUser(
    request: GetCurrentUserRequest,
    metadata?: Metadata,
  ): Promise<CurrentUserResponse> {
    return this.usersService.getCurrentUser(
      requireSelf(unpackCallerContext(metadata), request.userId),
    );
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
   * notification-service resolving an audience: system callers only.
   *
   * The tenant is a FIELD of the request because the caller is a background
   * consumer with no user, so a user's context (or a Super Admin's) is
   * refused rather than allowed to name a tenant.
   */
  listPermissionHolders(
    request: ListPermissionHoldersRequest,
    metadata?: Metadata,
  ): Promise<ListPermissionHoldersResponse> {
    requireSystem(unpackCallerContext(metadata));
    return this.usersService.listPermissionHolders(request);
  }

  /**
   * The gateway's inbound mail, for the tenant it resolved from the verified
   * address: system callers only. Takes the tenant, so it cannot create one —
   * see the service.
   */
  resolveInboundSender(
    request: ResolveInboundSenderRequest,
    metadata?: Metadata,
  ): Promise<ResolveInboundSenderResponse> {
    requireSystem(unpackCallerContext(metadata));
    return this.usersService.resolveInboundSender(request);
  }

  /**
   * Users by id in the request's tenant, which must be the caller's: a
   * gateway user's own tenant, or a job's. Another tenant answers as unknown
   * ids do, with nothing; a Super Admin is refused (`requireTenant`).
   */
  async listUsersByIds(
    request: ListUsersByIdsRequest,
    metadata?: Metadata,
  ): Promise<ListUsersByIdsResponse> {
    const tenant = requireTenant(unpackCallerContext(metadata));
    if (request.organizationId !== tenant) return { items: [], summaries: [] };

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
