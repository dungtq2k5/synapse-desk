import { Injectable } from '@nestjs/common';
import { RequestContext, RequestOrigin } from '@synapsedesk/common';
import { requireField } from '@synapsedesk/grpc-proto';
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import { UserServiceGrpcClient } from './users-service-grpc.client';
import {
  toCurrentUserResponseDto,
  toListUsersRequest,
  toLockUserRequest,
  toPresignAvatarResponseDto,
  toProfileFields,
  toUserResponseDto,
  toUserSummaryPageDto,
  toUserSummaryResponseDto,
  toUserResponseGqlDto,
} from './user.mapper';
import { ConfirmAvatarDto, PresignAvatarDto } from './dto/rest/avatar.dto';
import { PresignAvatarResponseDto } from './dto/rest/avatar-response.dto';
import {
  CurrentUserResponseDto,
  UserResponseDto,
} from './dto/rest/user-response.dto';
import { UpdateOwnProfileDto, UpdateUserDto } from './dto/rest/update-user.dto';
import { UserResponseGqlDto } from './dto/graphql/user-response.gql-dto';
import {
  UserPermissionsResponseDto,
  RevokedSessionCountResponseDto,
  UntrustedDeviceCountResponseDto,
  UserSummaryResponseDto,
} from './dto/rest/user-admin-response.dto';
import {
  CreateUserDto,
  ListUsersQueryDto,
  LockUserDto,
  SetUserDepartmentsDto,
  SetUserRolesDto,
} from './dto/rest/user-admin.dto';

/** The gateway's user surface. Returns REST DTOs; the wire stays in the client. */
@Injectable()
export class UsersService {
  constructor(private readonly usersGrpcClient: UserServiceGrpcClient) {}

  async getCurrentUser(
    userId: string,
    origin: RequestOrigin,
  ): Promise<CurrentUserResponseDto> {
    return toCurrentUserResponseDto(
      await this.usersGrpcClient.getCurrentUser(userId, origin),
    );
  }

  async updateOwnProfile(
    dto: UpdateOwnProfileDto,
    context: RequestContext,
  ): Promise<UserResponseDto> {
    return toUserResponseDto(
      await this.usersGrpcClient.updateOwnProfile(
        toProfileFields(dto),
        context,
      ),
    );
  }

  // ------------------------------------------------------------- avatars

  async presignAvatar(
    dto: PresignAvatarDto,
    context: RequestContext,
  ): Promise<PresignAvatarResponseDto> {
    return toPresignAvatarResponseDto(
      await this.usersGrpcClient.presignAvatar(
        {
          contentType: dto.contentType,
          sizeBytes: dto.sizeBytes,
          originalFileName: dto.fileName,
        },
        context,
      ),
    );
  }

  async confirmAvatar(
    dto: ConfirmAvatarDto,
    context: RequestContext,
  ): Promise<UserResponseDto> {
    return toUserResponseDto(
      await this.usersGrpcClient.confirmAvatar(
        { objectPath: dto.objectPath },
        context,
      ),
    );
  }

  async deleteAvatar(context: RequestContext): Promise<UserResponseDto> {
    return toUserResponseDto(await this.usersGrpcClient.deleteAvatar(context));
  }

  // --------------------------------------------------------------- admin

  async list(
    query: ListUsersQueryDto,
    context: RequestContext,
  ): Promise<PaginationResponseDto<UserSummaryResponseDto>> {
    return toUserSummaryPageDto(
      await this.usersGrpcClient.list(toListUsersRequest(query), context),
    );
  }

  async get(
    id: string,
    context: RequestContext,
  ): Promise<UserSummaryResponseDto> {
    return toUserSummaryResponseDto(
      await this.usersGrpcClient.get(id, context),
    );
  }

  /**
   * The caller's own profile, in the shape the GraphQL `User` type declares.
   *
   * @example
   * const me = await users.getCurrentUserGql(context.sub, context);
   */
  async getCurrentUserGql(
    userId: string,
    origin: RequestOrigin,
  ): Promise<UserResponseGqlDto> {
    return toUserResponseGqlDto(await this.getCurrentUser(userId, origin));
  }

  /**
   * One user in full, in the shape the GraphQL `User` type declares.
   *
   * @example
   * const user = await users.getGql(id, context);
   */
  async getGql(
    id: string,
    context: RequestContext,
  ): Promise<UserResponseGqlDto> {
    return toUserResponseGqlDto(await this.get(id, context));
  }

  /**
   * A page of users, each row in the shape the GraphQL `User` type declares.
   *
   * @example
   * const page = await users.listGql({ ...toPageQuery(args) }, context);
   */
  async listGql(
    query: ListUsersQueryDto,
    context: RequestContext,
  ): Promise<PaginationResponseDto<UserResponseGqlDto>> {
    const page = await this.list(query, context);

    return {
      // An arrow rather than `.map(toUserResponseGqlDto)`: `map` passes the
      // index as a second argument, and a mapper that later grows an optional
      // parameter would start receiving it silently.
      items: page.items.map((summary) => toUserResponseGqlDto(summary)),
      meta: page.meta,
    };
  }

  async getPermissions(
    id: string,
    context: RequestContext,
  ): Promise<UserPermissionsResponseDto> {
    const { permissionCodes } = await this.usersGrpcClient.getPermissions(
      id,
      context,
    );

    return { permissionCodes };
  }

  async create(
    dto: CreateUserDto,
    context: RequestContext,
  ): Promise<UserSummaryResponseDto> {
    const { user } = await this.usersGrpcClient.create(
      {
        email: dto.email,
        fullName: dto.fullName,
        roleIds: dto.roleIds,
        departmentIds: dto.departmentIds,
        primaryDepartmentId: dto.primaryDepartmentId,
      },
      context,
    );

    return toUserSummaryResponseDto(requireField(user, 'user'));
  }

  async update(
    id: string,
    dto: UpdateUserDto,
    context: RequestContext,
  ): Promise<UserSummaryResponseDto> {
    return toUserSummaryResponseDto(
      await this.usersGrpcClient.update(
        {
          id,
          ...toProfileFields(dto),
          phoneNumber: dto.phoneNumber ?? undefined,
        },
        context,
      ),
    );
  }

  remove(
    id: string,
    context: RequestContext,
  ): Promise<RevokedSessionCountResponseDto> {
    return this.usersGrpcClient.remove(id, context);
  }

  async restore(
    id: string,
    context: RequestContext,
  ): Promise<UserSummaryResponseDto> {
    return toUserSummaryResponseDto(
      await this.usersGrpcClient.restore(id, context),
    );
  }

  lock(
    id: string,
    dto: LockUserDto,
    context: RequestContext,
  ): Promise<RevokedSessionCountResponseDto> {
    return this.usersGrpcClient.lock(toLockUserRequest(id, dto), context);
  }

  unlock(id: string, context: RequestContext): Promise<void> {
    return this.usersGrpcClient.unlock(id, context);
  }

  resetTwoFactor(
    id: string,
    context: RequestContext,
  ): Promise<UntrustedDeviceCountResponseDto> {
    return this.usersGrpcClient.resetTwoFactor(id, context);
  }

  async setRoles(
    id: string,
    dto: SetUserRolesDto,
    context: RequestContext,
  ): Promise<UserSummaryResponseDto> {
    return toUserSummaryResponseDto(
      await this.usersGrpcClient.setRoles(
        { id, roleIds: dto.roleIds },
        context,
      ),
    );
  }

  async setDepartments(
    id: string,
    dto: SetUserDepartmentsDto,
    context: RequestContext,
  ): Promise<UserSummaryResponseDto> {
    return toUserSummaryResponseDto(
      await this.usersGrpcClient.setDepartments(
        { id, departments: dto.departments },
        context,
      ),
    );
  }
}
