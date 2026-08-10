import { Controller } from '@nestjs/common';
import type { Metadata } from '@grpc/grpc-js';
import {
  ListDepartmentsByIdsRequest,
  ListDepartmentsByIdsResponse,
  AddDepartmentMembersRequest,
  AddDepartmentMembersResponse,
  CreateDepartmentRequest,
  DeleteDepartmentResponse,
  DepartmentIdRequest,
  DepartmentResponse,
  DepartmentServiceController,
  DepartmentServiceControllerMethods,
  GetDepartmentRequest,
  ListDepartmentMembersRequest,
  ListDepartmentMembersResponse,
  ListDepartmentsRequest,
  ListDepartmentsResponse,
  RemoveDepartmentMemberRequest,
  RemoveDepartmentMemberResponse,
  unpackCallerContext,
  UpdateDepartmentRequest,
} from '@synapsedesk/grpc-proto';
import { DepartmentsService } from './departments.service';

/**
 * Every method needs the caller context, because every query is tenant-scoped
 * by it. That is why it is unpacked here uniformly rather than only where a
 * write needs an actor id — an RPC that forgot would be an unscoped read.
 */
@Controller()
@DepartmentServiceControllerMethods()
export class DepartmentsGrpcController implements DepartmentServiceController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  listDepartmentsByIds(
    request: ListDepartmentsByIdsRequest,
    metadata?: Metadata,
  ): Promise<ListDepartmentsByIdsResponse> {
    return this.departmentsService.listDepartmentsByIds(
      request,
      unpackCallerContext(metadata),
    );
  }

  listDepartments(
    request: ListDepartmentsRequest,
    metadata?: Metadata,
  ): Promise<ListDepartmentsResponse> {
    return this.departmentsService.listDepartments(
      request,
      unpackCallerContext(metadata),
    );
  }

  getDepartment(
    request: GetDepartmentRequest,
    metadata?: Metadata,
  ): Promise<DepartmentResponse> {
    return this.departmentsService.getDepartment(
      request,
      unpackCallerContext(metadata),
    );
  }

  createDepartment(
    request: CreateDepartmentRequest,
    metadata?: Metadata,
  ): Promise<DepartmentResponse> {
    return this.departmentsService.createDepartment(
      request,
      unpackCallerContext(metadata),
    );
  }

  updateDepartment(
    request: UpdateDepartmentRequest,
    metadata?: Metadata,
  ): Promise<DepartmentResponse> {
    return this.departmentsService.updateDepartment(
      request,
      unpackCallerContext(metadata),
    );
  }

  deleteDepartment(
    request: DepartmentIdRequest,
    metadata?: Metadata,
  ): Promise<DeleteDepartmentResponse> {
    return this.departmentsService.deleteDepartment(
      request,
      unpackCallerContext(metadata),
    );
  }

  restoreDepartment(
    request: DepartmentIdRequest,
    metadata?: Metadata,
  ): Promise<DepartmentResponse> {
    return this.departmentsService.restoreDepartment(
      request,
      unpackCallerContext(metadata),
    );
  }

  listDepartmentMembers(
    request: ListDepartmentMembersRequest,
    metadata?: Metadata,
  ): Promise<ListDepartmentMembersResponse> {
    return this.departmentsService.listDepartmentMembers(
      request,
      unpackCallerContext(metadata),
    );
  }

  addDepartmentMembers(
    request: AddDepartmentMembersRequest,
    metadata?: Metadata,
  ): Promise<AddDepartmentMembersResponse> {
    return this.departmentsService.addDepartmentMembers(
      request,
      unpackCallerContext(metadata),
    );
  }

  removeDepartmentMember(
    request: RemoveDepartmentMemberRequest,
    metadata?: Metadata,
  ): Promise<RemoveDepartmentMemberResponse> {
    return this.departmentsService.removeDepartmentMember(
      request,
      unpackCallerContext(metadata),
    );
  }
}
