import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  AUTH_GRPC_CLIENT,
  ROLE_SERVICE_NAME,
  RoleServiceClient,
  CreateRoleRequest,
  ListPermissionsResponse,
  ListRolesResponse,
  RoleResponse,
  SetRolePermissionsRequest,
  ListRolesRequest,
  UpdateRoleRequest,
} from '@synapsedesk/grpc-proto';
import { RequestContext } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';

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

  list(
    request: ListRolesRequest,
    context: RequestContext,
  ): Promise<ListRolesResponse> {
    return this.call(
      (metadata) => this.roleGrpcService.listRoles(request, metadata),
      context,
    );
  }

  get(id: string, context: RequestContext): Promise<RoleResponse> {
    return this.call(
      (metadata) => this.roleGrpcService.getRole({ id }, metadata),
      context,
    );
  }

  create(
    request: CreateRoleRequest,
    context: RequestContext,
  ): Promise<RoleResponse> {
    return this.call(
      (metadata) => this.roleGrpcService.createRole(request, metadata),
      context,
    );
  }

  update(
    request: UpdateRoleRequest,
    context: RequestContext,
  ): Promise<RoleResponse> {
    return this.call(
      (metadata) => this.roleGrpcService.updateRole(request, metadata),
      context,
    );
  }

  async remove(id: string, context: RequestContext): Promise<void> {
    await this.call(
      (metadata) => this.roleGrpcService.deleteRole({ id }, metadata),
      context,
    );
  }

  setPermissions(
    request: SetRolePermissionsRequest,
    context: RequestContext,
  ): Promise<RoleResponse> {
    return this.call(
      (metadata) => this.roleGrpcService.setRolePermissions(request, metadata),
      context,
    );
  }

  listPermissions(context: RequestContext): Promise<ListPermissionsResponse> {
    return this.call(
      (metadata) => this.roleGrpcService.listPermissions({}, metadata),
      context,
    );
  }
}
