import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  AUTH_GRPC_CLIENT,
  USER_SERVICE_NAME,
  UserServiceClient,
  requireProtoTimestamp,
  toPageRequest,
  toProtoGender,
  toProtoTimestamp,
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
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import { toPaginationMetaDataResponseDto } from '../../common/mappers/pagination.mapper';
import { toUserResponseDto, toUserSummaryResponseDto } from './user.mapper';
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

  async updateOwnProfile(
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

  async presignAvatar(
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
      expiresAt: requireProtoTimestamp(response.expiresAt, 'expiresAt'),
    }));
  }

  async confirmAvatar(
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

  async deleteAvatar(context: RequestContext): Promise<UserResponseDto> {
    return this.call(
      (metadata) => this.userGrpcService.deleteAvatar({}, metadata),
      context,
    ).then(toUserResponseDto);
  }

  async list(
    query: ListUsersQueryDto,
    context: RequestContext,
  ): Promise<PaginationResponseDto<UserSummaryResponseDto>> {
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
      items: response.items.map(toUserSummaryResponseDto),
      meta: toPaginationMetaDataResponseDto(response.meta),
    };
  }

  async get(
    id: string,
    context: RequestContext,
  ): Promise<UserSummaryResponseDto> {
    return this.call(
      (metadata) => this.userGrpcService.getUser({ id }, metadata),
      context,
    ).then(toUserSummaryResponseDto);
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

    return toUserSummaryResponseDto(response.user!);
  }

  async update(
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
    ).then(toUserSummaryResponseDto);
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

  async restore(
    id: string,
    context: RequestContext,
  ): Promise<UserSummaryResponseDto> {
    return this.call(
      (metadata) => this.userGrpcService.restoreUser({ id }, metadata),
      context,
    ).then(toUserSummaryResponseDto);
  }

  lock(
    id: string,
    dto: LockUserDto,
    context: RequestContext,
  ): Promise<{ revokedSessionCount: number }> {
    return this.call(
      (metadata) =>
        this.userGrpcService.lockUser(
          {
            id,
            reason: dto.reason,
            // Absent stays absent — an INDEFINITE lock, which is the existing
            // behaviour and what an admin gets by not choosing (21-doc §2).
            lockedUntil: dto.lockedUntil
              ? toProtoTimestamp(new Date(dto.lockedUntil))
              : undefined,
          },
          metadata,
        ),
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

  async setRoles(
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
    ).then(toUserSummaryResponseDto);
  }

  async setDepartments(
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
    ).then(toUserSummaryResponseDto);
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
