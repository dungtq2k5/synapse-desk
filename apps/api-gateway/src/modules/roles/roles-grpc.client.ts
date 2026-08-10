import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  AUTH_GRPC_CLIENT,
  ROLE_SERVICE_NAME,
  RoleServiceClient,
  toPageRequest,
} from '@synapsedesk/grpc-proto';
import { RequestContext } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import { toPaginationMetaDataResponseDto } from '../../common/mappers/pagination.mapper';
import { toPermissionResponseDto, toRoleResponseDto } from './role.mapper';
import {
  CreateRoleDto,
  ListRolesQueryDto,
  PermissionResponseDto,
  RoleResponseDto,
  SetRolePermissionsDto,
  UpdateRoleDto,
} from './dto/rest/role.dto';

@Injectable()
export class RolesGrpcClient extends BaseGrpcClient implements OnModuleInit {
  protected readonly serviceName = 'auth-service';

  private roleGrpcService!: RoleServiceClient;

  constructor(@Inject(AUTH_GRPC_CLIENT) private readonly client: ClientGrpc) {
    super();
  }

  onModuleInit() {
    this.roleGrpcService =
      this.client.getService<RoleServiceClient>(ROLE_SERVICE_NAME);
  }

  async list(
    query: ListRolesQueryDto,
    context: RequestContext,
  ): Promise<PaginationResponseDto<RoleResponseDto>> {
    const response = await this.call(
      (metadata) =>
        this.roleGrpcService.listRoles(
          { page: toPageRequest(query), includeSystem: query.includeSystem },
          metadata,
        ),
      context,
    );

    return {
      items: response.items.map(toRoleResponseDto),
      meta: toPaginationMetaDataResponseDto(response.meta),
    };
  }

  async get(id: string, context: RequestContext): Promise<RoleResponseDto> {
    return toRoleResponseDto(
      await this.call(
        (metadata) => this.roleGrpcService.getRole({ id }, metadata),
        context,
      ),
    );
  }

  async create(
    dto: CreateRoleDto,
    context: RequestContext,
  ): Promise<RoleResponseDto> {
    return toRoleResponseDto(
      await this.call(
        (metadata) =>
          this.roleGrpcService.createRole(
            {
              name: dto.name,
              description: dto.description,
              permissionCodes: dto.permissionCodes,
            },
            metadata,
          ),
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
      await this.call(
        (metadata) =>
          this.roleGrpcService.updateRole(
            { id, name: dto.name, description: dto.description },
            metadata,
          ),
        context,
      ),
    );
  }

  async remove(id: string, context: RequestContext): Promise<void> {
    await this.call(
      (metadata) => this.roleGrpcService.deleteRole({ id }, metadata),
      context,
    );
  }

  async setPermissions(
    id: string,
    dto: SetRolePermissionsDto,
    context: RequestContext,
  ): Promise<RoleResponseDto> {
    return toRoleResponseDto(
      await this.call(
        (metadata) =>
          this.roleGrpcService.setRolePermissions(
            { id, permissionCodes: dto.permissionCodes },
            metadata,
          ),
        context,
      ),
    );
  }

  async listPermissions(
    context: RequestContext,
  ): Promise<PermissionResponseDto[]> {
    const response = await this.call(
      (metadata) => this.roleGrpcService.listPermissions({}, metadata),
      context,
    );

    return response.items.map(toPermissionResponseDto);
  }
}
