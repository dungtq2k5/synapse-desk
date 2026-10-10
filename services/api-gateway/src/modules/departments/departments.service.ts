import { Injectable } from '@nestjs/common';
import { RequestContext } from '@synapsedesk/common';
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import { DepartmentsGrpcClient } from './departments-grpc.client';
import {
  toDepartmentMemberPageDto,
  toDepartmentPageDto,
  toListDepartmentMembersRequest,
  toListDepartmentsRequest,
  toDepartmentResponseDto,
} from './department.mapper';
import {
  AddDepartmentMembersDto,
  CreateDepartmentDto,
  ListDepartmentMembersQueryDto,
  ListDepartmentsQueryDto,
  UpdateDepartmentDto,
} from './dto/rest/department.dto';
import {
  AddDepartmentMembersResponseDto,
  DepartmentMemberResponseDto,
  DepartmentResponseDto,
} from './dto/rest/department-response.dto';

/** The gateway's department surface. Returns REST DTOs; the wire stays in the client. */
@Injectable()
export class DepartmentsService {
  constructor(private readonly departmentsGrpcClient: DepartmentsGrpcClient) {}

  async list(
    query: ListDepartmentsQueryDto,
    context: RequestContext,
  ): Promise<PaginationResponseDto<DepartmentResponseDto>> {
    return toDepartmentPageDto(
      await this.departmentsGrpcClient.list(
        toListDepartmentsRequest(query),
        context,
      ),
    );
  }

  async get(
    id: string,
    context: RequestContext,
  ): Promise<DepartmentResponseDto> {
    return toDepartmentResponseDto(
      await this.departmentsGrpcClient.get(id, context),
    );
  }

  async create(
    dto: CreateDepartmentDto,
    context: RequestContext,
  ): Promise<DepartmentResponseDto> {
    return toDepartmentResponseDto(
      await this.departmentsGrpcClient.create(
        { name: dto.name, description: dto.description },
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
      // Passed through as-is: an absent key stays absent on the wire, which is
      // what carries "leave unchanged" to the service.
      await this.departmentsGrpcClient.update(
        { id, name: dto.name, description: dto.description },
        context,
      ),
    );
  }

  remove(id: string, context: RequestContext): Promise<void> {
    return this.departmentsGrpcClient.remove(id, context);
  }

  async restore(
    id: string,
    context: RequestContext,
  ): Promise<DepartmentResponseDto> {
    return toDepartmentResponseDto(
      await this.departmentsGrpcClient.restore(id, context),
    );
  }

  async listMembers(
    departmentId: string,
    query: ListDepartmentMembersQueryDto,
    context: RequestContext,
  ): Promise<PaginationResponseDto<DepartmentMemberResponseDto>> {
    return toDepartmentMemberPageDto(
      await this.departmentsGrpcClient.listMembers(
        toListDepartmentMembersRequest(departmentId, query),
        context,
      ),
    );
  }

  addMembers(
    departmentId: string,
    dto: AddDepartmentMembersDto,
    context: RequestContext,
  ): Promise<AddDepartmentMembersResponseDto> {
    return this.departmentsGrpcClient.addMembers(
      { departmentId, userIds: dto.userIds, isPrimary: dto.isPrimary },
      context,
    );
  }

  removeMember(
    departmentId: string,
    userId: string,
    context: RequestContext,
  ): Promise<void> {
    return this.departmentsGrpcClient.removeMember(
      departmentId,
      userId,
      context,
    );
  }
}
