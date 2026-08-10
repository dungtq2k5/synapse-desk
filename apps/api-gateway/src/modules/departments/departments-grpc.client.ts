import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  AUTH_GRPC_CLIENT,
  DEPARTMENT_SERVICE_NAME,
  DepartmentServiceClient,
  toPageRequest,
} from '@synapsedesk/grpc-proto';
import { RequestContext } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import { toPaginationMetaDataResponseDto } from '../../common/mappers/pagination.mapper';
import {
  toDepartmentResponseDto,
  toDepartmentMemberResponseDto,
} from './department.mapper';
import {
  AddDepartmentMembersDto,
  AddDepartmentMembersResponseDto,
  CreateDepartmentDto,
  DepartmentMemberResponseDto,
  DepartmentResponseDto,
  ListDepartmentMembersQueryDto,
  ListDepartmentsQueryDto,
  UpdateDepartmentDto,
} from './dto/rest/department.dto';

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

  async list(
    query: ListDepartmentsQueryDto,
    context: RequestContext,
  ): Promise<PaginationResponseDto<DepartmentResponseDto>> {
    const response = await this.call(
      (metadata) =>
        this.departmentGrpcService.listDepartments(
          {
            page: toPageRequest(query),
            includeDeleted: query.includeDeleted,
          },
          metadata,
        ),
      context,
    );

    return {
      items: response.items.map(toDepartmentResponseDto),
      meta: toPaginationMetaDataResponseDto(response.meta),
    };
  }

  async get(
    id: string,
    context: RequestContext,
  ): Promise<DepartmentResponseDto> {
    return toDepartmentResponseDto(
      await this.call(
        (metadata) =>
          this.departmentGrpcService.getDepartment({ id }, metadata),
        context,
      ),
    );
  }

  async create(
    dto: CreateDepartmentDto,
    context: RequestContext,
  ): Promise<DepartmentResponseDto> {
    return toDepartmentResponseDto(
      await this.call(
        (metadata) =>
          this.departmentGrpcService.createDepartment(
            { name: dto.name, description: dto.description },
            metadata,
          ),
        context,
      ),
    );
  }

  async update(
    id: string,
    dto: UpdateDepartmentDto,
    context: RequestContext,
  ): Promise<DepartmentResponseDto> {
    return toDepartmentResponseDto(
      await this.call(
        (metadata) =>
          this.departmentGrpcService.updateDepartment(
            // Passed through as-is: an absent key stays absent on the wire,
            // which is what carries "leave unchanged" to the service.
            { id, name: dto.name, description: dto.description },
            metadata,
          ),
        context,
      ),
    );
  }

  async remove(id: string, context: RequestContext): Promise<void> {
    await this.call(
      (metadata) =>
        this.departmentGrpcService.deleteDepartment({ id }, metadata),
      context,
    );
  }

  async restore(
    id: string,
    context: RequestContext,
  ): Promise<DepartmentResponseDto> {
    return toDepartmentResponseDto(
      await this.call(
        (metadata) =>
          this.departmentGrpcService.restoreDepartment({ id }, metadata),
        context,
      ),
    );
  }

  async listMembers(
    departmentId: string,
    query: ListDepartmentMembersQueryDto,
    context: RequestContext,
  ): Promise<PaginationResponseDto<DepartmentMemberResponseDto>> {
    const response = await this.call(
      (metadata) =>
        this.departmentGrpcService.listDepartmentMembers(
          { departmentId, page: toPageRequest(query) },
          metadata,
        ),
      context,
    );

    return {
      items: response.items.map(toDepartmentMemberResponseDto),
      meta: toPaginationMetaDataResponseDto(response.meta),
    };
  }

  addMembers(
    departmentId: string,
    dto: AddDepartmentMembersDto,
    context: RequestContext,
  ): Promise<AddDepartmentMembersResponseDto> {
    return this.call(
      (metadata) =>
        this.departmentGrpcService.addDepartmentMembers(
          {
            departmentId,
            userIds: dto.userIds,
            isPrimary: dto.isPrimary,
          },
          metadata,
        ),
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
