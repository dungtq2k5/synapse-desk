import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  AUTH_GRPC_CLIENT,
  USER_SERVICE_NAME,
  UserServiceClient,
  requireTimestamp,
  toPageRequest,
  toProtoGender,
} from '@synapsedesk/grpc-proto';
import {
  PermissionCode,
  RequestContext,
  RequestOrigin,
} from '@synapsedesk/common';
import {
  ConfirmAvatarDto,
  PresignAvatarDto,
  PresignAvatarResponseDto,
} from './dto/rest/avatar.dto';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';
import { PaginationResponseBase } from '../../common/dto/base/pagination-response-base.dto';
import { toPaginationMeta } from '../../common/mappers/pagination.mapper';
import { toUserResponseDto, toUserSummaryDto } from './user.mapper';
import {
  CurrentUserResponseDto,
  UserResponseDto,
} from './dto/rest/user-response.dto';
import { UpdateOwnProfileDto, UpdateUserDto } from './dto/rest/update-user.dto';
import {
  CreateUserDto,
  ListUsersQueryDto,
  LockUserDto,
  SetUserDepartmentsDto,
  SetUserRolesDto,
  UserSummaryResponseDto,
} from './dto/rest/user-admin.dto';

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
  updateOwnProfile(
    dto: UpdateOwnProfileDto,
    context: RequestContext,
  ): Promise<UserResponseDto> {
    return this.call(
      (metadata) =>
        this.userGrpcService.updateOwnProfile(toProfileFields(dto), metadata),
      context,
    ).then(toUserResponseDto);
  }

  // ------------------------------------------------------------- avatars

  presignAvatar(
    dto: PresignAvatarDto,
    context: RequestContext,
  ): Promise<PresignAvatarResponseDto> {
    return this.call(
      (metadata) =>
        this.userGrpcService.presignAvatarUpload(
          {
            contentType: dto.contentType,
            sizeBytes: dto.sizeBytes,
            originalFileName: dto.fileName,
          },
          metadata,
        ),
      context,
    ).then((response) => ({
      uploadUrl: response.uploadUrl,
      objectPath: response.objectPath,
      expiresAt: requireTimestamp(response.expiresAt, 'expiresAt'),
    }));
  }

  confirmAvatar(
    dto: ConfirmAvatarDto,
    context: RequestContext,
  ): Promise<UserResponseDto> {
    return this.call(
      (metadata) =>
        this.userGrpcService.confirmAvatarUpload(
          { objectPath: dto.objectPath },
          metadata,
        ),
      context,
    ).then(toUserResponseDto);
  }

  deleteAvatar(context: RequestContext): Promise<UserResponseDto> {
    return this.call(
      (metadata) => this.userGrpcService.deleteAvatar({}, metadata),
      context,
    ).then(toUserResponseDto);
  }

  async list(
    query: ListUsersQueryDto,
    context: RequestContext,
  ): Promise<PaginationResponseBase<UserSummaryResponseDto>> {
    const response = await this.call(
      (metadata) =>
        this.userGrpcService.listUsers(
          {
            page: toPageRequest(query),
            departmentId: query.departmentId,
            roleId: query.roleId,
            isLocked: query.isLocked,
            includeDeleted: query.includeDeleted,
          },
          metadata,
        ),
      context,
    );

    return {
      items: response.items.map(toUserSummaryDto),
      meta: toPaginationMeta(response.meta),
    };
  }

  get(id: string, context: RequestContext): Promise<UserSummaryResponseDto> {
    return this.call(
      (metadata) => this.userGrpcService.getUser({ id }, metadata),
      context,
    ).then(toUserSummaryDto);
  }

  async getPermissions(id: string, context: RequestContext): Promise<string[]> {
    const response = await this.call(
      (metadata) => this.userGrpcService.getUserPermissions({ id }, metadata),
      context,
    );

    return response.permissionCodes;
  }

  async create(
    dto: CreateUserDto,
    context: RequestContext,
  ): Promise<UserSummaryResponseDto> {
    const response = await this.call(
      (metadata) =>
        this.userGrpcService.createUser(
          {
            email: dto.email,
            fullName: dto.fullName,
            roleIds: dto.roleIds ?? [],
            departmentIds: dto.departmentIds ?? [],
            primaryDepartmentId: dto.primaryDepartmentId,
          },
          metadata,
        ),
      context,
    );

    return toUserSummaryDto(response.user!);
  }

  update(
    id: string,
    dto: UpdateUserDto,
    context: RequestContext,
  ): Promise<UserSummaryResponseDto> {
    return this.call(
      (metadata) =>
        this.userGrpcService.updateUser(
          {
            id,
            ...toProfileFields(dto),
            phoneNumber: dto.phoneNumber ?? undefined,
          },
          metadata,
        ),
      context,
    ).then(toUserSummaryDto);
  }

  async remove(
    id: string,
    context: RequestContext,
  ): Promise<{ revokedSessionCount: number }> {
    return this.call(
      (metadata) => this.userGrpcService.deleteUser({ id }, metadata),
      context,
    );
  }

  restore(
    id: string,
    context: RequestContext,
  ): Promise<UserSummaryResponseDto> {
    return this.call(
      (metadata) => this.userGrpcService.restoreUser({ id }, metadata),
      context,
    ).then(toUserSummaryDto);
  }

  lock(
    id: string,
    dto: LockUserDto,
    context: RequestContext,
  ): Promise<{ revokedSessionCount: number }> {
    return this.call(
      (metadata) =>
        this.userGrpcService.lockUser({ id, reason: dto.reason }, metadata),
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
  ): Promise<{ untrustedDeviceCount: number }> {
    return this.call(
      (metadata) => this.userGrpcService.resetUserTwoFactor({ id }, metadata),
      context,
    );
  }

  setRoles(
    id: string,
    dto: SetUserRolesDto,
    context: RequestContext,
  ): Promise<UserSummaryResponseDto> {
    return this.call(
      (metadata) =>
        this.userGrpcService.setUserRoles(
          { id, roleIds: dto.roleIds },
          metadata,
        ),
      context,
    ).then(toUserSummaryDto);
  }

  setDepartments(
    id: string,
    dto: SetUserDepartmentsDto,
    context: RequestContext,
  ): Promise<UserSummaryResponseDto> {
    return this.call(
      (metadata) =>
        this.userGrpcService.setUserDepartments(
          { id, departments: dto.departments },
          metadata,
        ),
      context,
    ).then(toUserSummaryDto);
  }
}

/**
 * The profile fields shared by own-profile and admin updates.
 *
 * `null` from the REST DTO becomes an EMPTY STRING on the wire, not
 * `undefined`: proto3 has no null, so the service distinguishes "leave
 * unchanged" (absent) from "clear it" (empty) — and mapping null to undefined
 * would silently turn every clear into a no-op.
 */
function toProfileFields(dto: {
  fullName?: string;
  gender?: string;
  dob?: string | null;
}) {
  return {
    fullName: dto.fullName,
    gender: dto.gender === undefined ? undefined : toProtoGender(dto.gender),
    dob: dto.dob === null ? '' : dto.dob,
  };
}
