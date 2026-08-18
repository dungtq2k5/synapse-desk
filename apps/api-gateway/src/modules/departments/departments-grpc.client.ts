import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  AUTH_GRPC_CLIENT,
  DEPARTMENT_SERVICE_NAME,
  DepartmentServiceClient,
  AddDepartmentMembersRequest,
  AddDepartmentMembersResponse,
  CreateDepartmentRequest,
  DepartmentResponse,
  ListDepartmentMembersResponse,
  ListDepartmentsResponse,
  ListDepartmentMembersRequest,
  ListDepartmentsRequest,
  UpdateDepartmentRequest,
} from '@synapsedesk/grpc-proto';
import { RequestContext } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';

/**
 * Every method takes the full `RequestContext`, not a bare origin.
 *
 * `BaseGrpcClient.call` packs it into metadata, which is how the tenant reaches
 * auth-service. Narrowing any of these to `RequestOrigin` would strip the
 * identity and the service would reject the call — which is the intended
 * failure mode: an unscoped query is not among the outcomes.
 */
@Injectable()
export class DepartmentsGrpcClient
  extends BaseGrpcClient
  implements OnModuleInit
{
  protected readonly serviceName = 'auth-service';

  private departmentGrpcService!: DepartmentServiceClient;

  constructor(@Inject(AUTH_GRPC_CLIENT) private readonly client: ClientGrpc) {
    super();
  }

  onModuleInit() {
    this.departmentGrpcService =
      this.client.getService<DepartmentServiceClient>(DEPARTMENT_SERVICE_NAME);
  }

  list(
    request: ListDepartmentsRequest,
    context: RequestContext,
  ): Promise<ListDepartmentsResponse> {
    return this.call(
      (metadata) =>
        this.departmentGrpcService.listDepartments(request, metadata),
      context,
    );
  }

  get(id: string, context: RequestContext): Promise<DepartmentResponse> {
    return this.call(
      (metadata) => this.departmentGrpcService.getDepartment({ id }, metadata),
      context,
    );
  }

  create(
    request: CreateDepartmentRequest,
    context: RequestContext,
  ): Promise<DepartmentResponse> {
    return this.call(
      (metadata) =>
        this.departmentGrpcService.createDepartment(request, metadata),
      context,
    );
  }

  update(
    request: UpdateDepartmentRequest,
    context: RequestContext,
  ): Promise<DepartmentResponse> {
    return this.call(
      (metadata) =>
        this.departmentGrpcService.updateDepartment(request, metadata),
      context,
    );
  }

  async remove(id: string, context: RequestContext): Promise<void> {
    await this.call(
      (metadata) =>
        this.departmentGrpcService.deleteDepartment({ id }, metadata),
      context,
    );
  }

  restore(id: string, context: RequestContext): Promise<DepartmentResponse> {
    return this.call(
      (metadata) =>
        this.departmentGrpcService.restoreDepartment({ id }, metadata),
      context,
    );
  }

  listMembers(
    request: ListDepartmentMembersRequest,
    context: RequestContext,
  ): Promise<ListDepartmentMembersResponse> {
    return this.call(
      (metadata) =>
        this.departmentGrpcService.listDepartmentMembers(request, metadata),
      context,
    );
  }

  addMembers(
    request: AddDepartmentMembersRequest,
    context: RequestContext,
  ): Promise<AddDepartmentMembersResponse> {
    return this.call(
      (metadata) =>
        this.departmentGrpcService.addDepartmentMembers(request, metadata),
      context,
    );
  }

  async removeMember(
    departmentId: string,
    userId: string,
    context: RequestContext,
  ): Promise<void> {
    await this.call(
      (metadata) =>
        this.departmentGrpcService.removeDepartmentMember(
          { departmentId, userId },
          metadata,
        ),
      context,
    );
  }
}
