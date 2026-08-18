import { Injectable } from '@nestjs/common';
import { RequestContext } from '@synapsedesk/common';
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import { RolesGrpcClient } from './roles-grpc.client';
import {
  toPermissionResponseDtos,
  toListRolesRequest,
  toRolePageDto,
  toRoleResponseDto,
} from './role.mapper';
import {
  CreateRoleDto,
  ListRolesQueryDto,
  SetRolePermissionsDto,
  UpdateRoleDto,
} from './dto/rest/role.dto';
import {
  PermissionResponseDto,
  RoleResponseDto,
} from './dto/rest/role-response.dto';

/** The gateway's role surface. Returns REST DTOs; the wire stays in the client. */
@Injectable()
export class RolesService {
  constructor(private readonly rolesGrpcClient: RolesGrpcClient) {}

  async list(
    query: ListRolesQueryDto,
    context: RequestContext,
  ): Promise<PaginationResponseDto<RoleResponseDto>> {
    return toRolePageDto(
      await this.rolesGrpcClient.list(toListRolesRequest(query), context),
    );
  }

  async get(id: string, context: RequestContext): Promise<RoleResponseDto> {
    return toRoleResponseDto(await this.rolesGrpcClient.get(id, context));
  }

  async create(
    dto: CreateRoleDto,
    context: RequestContext,
  ): Promise<RoleResponseDto> {
    return toRoleResponseDto(
      await this.rolesGrpcClient.create(
        {
          name: dto.name,
          description: dto.description,
          permissionCodes: dto.permissionCodes,
        },
        context,
      ),
    );
  }

  async update(
    id: string,
    dto: UpdateRoleDto,
    context: RequestContext,
  ): Promise<RoleResponseDto> {
    return toRoleResponseDto(
      await this.rolesGrpcClient.update(
        { id, name: dto.name, description: dto.description },
        context,
      ),
    );
  }

  remove(id: string, context: RequestContext): Promise<void> {
    return this.rolesGrpcClient.remove(id, context);
  }

  async setPermissions(
    id: string,
    dto: SetRolePermissionsDto,
    context: RequestContext,
  ): Promise<RoleResponseDto> {
    return toRoleResponseDto(
      await this.rolesGrpcClient.setPermissions(
        { id, permissionCodes: dto.permissionCodes },
        context,
      ),
    );
  }

  async listPermissions(
    context: RequestContext,
  ): Promise<PermissionResponseDto[]> {
    return toPermissionResponseDtos(
      await this.rolesGrpcClient.listPermissions(context),
    );
  }
}
