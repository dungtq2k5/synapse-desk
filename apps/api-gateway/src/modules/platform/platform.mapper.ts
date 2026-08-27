import {
  CreatePlatformOrganizationResponse,
  fromProtoTimestamp,
  ListGlobalRolesResponse,
  ListPlatformOrganizationsRequest,
  ListPlatformOrganizationsResponse,
  ListPlatformUsersRequest,
  ListPlatformUsersResponse,
  PlatformMetricsResponse,
  PlatformOrganizationResponse,
  requireField,
  requireProtoTimestamp,
  toPageRequest,
  toProtoAiModelTier,
  toProtoOrgStatus,
  fromProtoAiModelTier,
  type ApplyPlanResponse,
  type CreatePlanRequest,
  type ListPlansRequest,
  type ListPlansResponse,
  type SubscriptionPlanResponse,
  type UpdatePlanRequest,
} from '@synapsedesk/grpc-proto';
import { DEFAULT_AI_MODEL_TIER } from '@synapsedesk/common';
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import { toPaginationMetaDataResponseDto } from '../../common/mappers/pagination.mapper';
import { toUserResponseDto } from '../users/user.mapper';
import { toRoleResponseDto } from '../roles/role.mapper';
import {
  CreatePlanDto,
  ListPlansQueryDto,
  ListPlatformOrganizationsQueryDto,
  ListPlatformUsersQueryDto,
  RoleResponseDto,
  UpdatePlanDto,
} from './dto/rest/platform.dto';
import {
  ApplyPlanResponseDto,
  CreatePlatformOrganizationResponseDto,
  PlatformMetricsResponseDto,
  PlatformOrganizationResponseDto,
  PlatformUserResponseDto,
  SubscriptionPlanResponseDto,
} from './dto/rest/platform-response.dto';
import { toOrganizationResponseDto } from '../organizations/organization.mapper';

export function toPlatformOrganizationResponseDto(
  row: PlatformOrganizationResponse,
): PlatformOrganizationResponseDto {
  return {
    organization: toOrganizationResponseDto(row.organization!),
    userCount: row.userCount,
    pendingInvitationCount: row.pendingInvitationCount,
    departmentCount: row.departmentCount,
    deletedAt: fromProtoTimestamp(row.deletedAt) ?? null,
  };
}

/** Builds a `ListPlatformOrganizationsRequest` from the REST query. */
export function toListPlatformOrganizationsRequest(
  query: ListPlatformOrganizationsQueryDto,
): ListPlatformOrganizationsRequest {
  return {
    page: toPageRequest(query),
    status:
      query.status === undefined ? undefined : toProtoOrgStatus(query.status),
    includeDeleted: query.includeDeleted,
  };
}

/** Builds a `ListPlatformUsersRequest` from the REST query. */
export function toListPlatformUsersRequest(
  query: ListPlatformUsersQueryDto,
): ListPlatformUsersRequest {
  return {
    page: toPageRequest(query),
    organizationId: query.organizationId,
    includeDeleted: query.includeDeleted,
  };
}

/** Converts a `ListPlatformOrganizationsResponse` into the paginated REST envelope. */
export function toPlatformOrganizationPageDto(
  response: ListPlatformOrganizationsResponse,
): PaginationResponseDto<PlatformOrganizationResponseDto> {
  return {
    items: response.items.map(toPlatformOrganizationResponseDto),
    meta: toPaginationMetaDataResponseDto(response.meta),
  };
}

/**
 * Converts a `CreatePlatformOrganizationResponse` off the wire into its REST DTO.
 *
 * @throws Error if the organization or its admin is missing.
 */
export function toCreatePlatformOrganizationResponseDto(
  response: CreatePlatformOrganizationResponse,
): CreatePlatformOrganizationResponseDto {
  return {
    organization: toPlatformOrganizationResponseDto(
      requireField(response.organization, 'organization'),
    ),
    admin: toUserResponseDto(requireField(response.admin, 'admin')),
  };
}

/** Converts a `ListPlatformUsersResponse` into the paginated REST envelope. */
export function toPlatformUserPageDto(
  response: ListPlatformUsersResponse,
): PaginationResponseDto<PlatformUserResponseDto> {
  return {
    items: response.items.map((row) => ({
      user: toUserResponseDto(requireField(row.user, 'user')),
      organizationId: row.organizationId ?? null,
      organizationName: row.organizationName ?? null,
      roleNames: row.roleNames,
      deletedAt: fromProtoTimestamp(row.deletedAt) ?? null,
    })),
    meta: toPaginationMetaDataResponseDto(response.meta),
  };
}

/** Converts a `ListGlobalRolesResponse` into the paginated REST envelope. */
export function toGlobalRolePageDto(
  response: ListGlobalRolesResponse,
): PaginationResponseDto<RoleResponseDto> {
  return {
    items: response.items.map(toRoleResponseDto),
    meta: toPaginationMetaDataResponseDto(response.meta),
  };
}

/**
 * Converts a `PlatformMetricsResponse` off the wire into its REST DTO.
 *
 * @throws Error if `generatedAt` is missing, which the proto requires.
 */
export function toPlatformMetricsResponseDto(
  response: PlatformMetricsResponse,
): PlatformMetricsResponseDto {
  return {
    totalOrganizations: response.totalOrganizations,
    organizationsByStatus: response.organizationsByStatus,
    totalUsers: response.totalUsers,
    activeUsers: response.activeUsers,
    pendingInvitations: response.pendingInvitations,
    liveSessions: response.liveSessions,
    seatsAllocated: response.seatsAllocated,
    seatsInUse: response.seatsInUse,
    generatedAt: requireProtoTimestamp(response.generatedAt, 'generatedAt'),
  };
}

export function toSubscriptionPlanResponseDto(
  plan: SubscriptionPlanResponse,
): SubscriptionPlanResponseDto {
  return {
    id: plan.id,
    name: plan.name,
    stripeProductId: plan.stripeProductId ?? null,
    maxAgentSeats: plan.maxAgentSeats,
    maxStorageBytes: plan.maxStorageBytes,
    monthlyAiTokenBudget: plan.monthlyAiTokenBudget,
    aiModelTier:
      fromProtoAiModelTier(plan.aiModelTier) ?? DEFAULT_AI_MODEL_TIER,
    maxDocumentBytes: plan.maxDocumentBytes,
    maxAttachmentBytes: plan.maxAttachmentBytes,
    isActive: plan.isActive,
    // **Yes, the `map` is needed** — not for the shape, which is identical
    // today, but as the projection boundary. `prices: plan.prices` would pass
    // wire objects straight into the public response, so the next field added
    // to `SubscriptionPlanPriceResponse` would appear in the REST API with
    // nobody deciding it should. Naming each field is what makes that a
    // decision rather than a default.
    prices: plan.prices.map((price) => ({
      id: price.id,
      stripePriceId: price.stripePriceId,
      interval: price.interval,
    })),
    subscriberCount: plan.subscriberCount,
    createdAt: requireProtoTimestamp(plan.createdAt, 'createdAt'),
    updatedAt: requireProtoTimestamp(plan.updatedAt, 'updatedAt'),
    deletedAt: fromProtoTimestamp(plan.deletedAt) ?? null,
  };
}

export function toSubscriptionPlanPageDto(
  response: ListPlansResponse,
): PaginationResponseDto<SubscriptionPlanResponseDto> {
  return {
    items: response.items.map(toSubscriptionPlanResponseDto),
    meta: toPaginationMetaDataResponseDto(response.meta),
  };
}

export function toApplyPlanResponseDto(
  response: ApplyPlanResponse,
): ApplyPlanResponseDto {
  return {
    // The same projection boundary as `prices` above: the shapes match today,
    // and copying field by field is what stops a new wire field becoming a
    // public one by accident.
    subscribers: response.subscribers.map((row) => ({
      organizationId: row.organizationId,
      organizationName: row.organizationName,
      changes: row.changes,
      overLimit: row.overLimit,
      skippedPinned: row.skippedPinned,
      budgetDeferred: row.budgetDeferred,
    })),
    dryRun: response.dryRun,
    changedCount: response.changedCount,
    skippedPinnedCount: response.skippedPinnedCount,
    overLimitCount: response.overLimitCount,
    evaluatedDimensions: response.evaluatedDimensions,
  };
}

export function toCreatePlanRequest(dto: CreatePlanDto): CreatePlanRequest {
  return {
    name: dto.name,
    stripeProductId: dto.stripeProductId,
    maxAgentSeats: dto.maxAgentSeats,
    maxStorageBytes: dto.maxStorageBytes,
    monthlyAiTokenBudget: dto.monthlyAiTokenBudget,
    aiModelTier: toProtoAiModelTier(dto.aiModelTier),
    maxDocumentBytes: dto.maxDocumentBytes,
    maxAttachmentBytes: dto.maxAttachmentBytes,
    // No `?? true` here, and that is the point of the DTO default: the `?` on
    // an implicit-presence field costs every layer below it a branch, so the
    // default is written once at the edge and this layer reads a boolean.
    isActive: dto.isActive,
    prices: dto.prices.map((price) => ({
      stripePriceId: price.stripePriceId,
      interval: price.interval,
    })),
  };
}

export function toUpdatePlanRequest(
  planId: string,
  dto: UpdatePlanDto,
): UpdatePlanRequest {
  return {
    planId,
    name: dto.name,
    stripeProductId: dto.stripeProductId,
    // The `??` STAYS here, and the asymmetry is the whole of §5.2: this DTO
    // feeds an `optional` proto message where a default would clear the product
    // id on every PATCH that never mentioned it. The absent case is handled at
    // the mapper precisely because it must not be handled at the DTO.
    clearStripeProductId: dto.clearStripeProductId ?? false,
    maxAgentSeats: dto.maxAgentSeats,
    maxStorageBytes: dto.maxStorageBytes,
    monthlyAiTokenBudget: dto.monthlyAiTokenBudget,
    // `undefined` stays undefined — the proto field is `optional` and absent
    // means "leave it". Mapping it through the enum bridge unconditionally
    // would send UNSPECIFIED, which the service refuses.
    aiModelTier:
      dto.aiModelTier === undefined
        ? undefined
        : toProtoAiModelTier(dto.aiModelTier),
    maxDocumentBytes: dto.maxDocumentBytes,
    maxAttachmentBytes: dto.maxAttachmentBytes,
    isActive: dto.isActive,
  };
}

export function toListPlansRequest(dto: ListPlansQueryDto): ListPlansRequest {
  return {
    // `toPageRequest` fills sort and search, which this endpoint does not
    // expose: the catalogue is a short list read in creation order.
    page: toPageRequest(dto),
    includeInactive: dto.includeInactive,
    includeDeleted: dto.includeDeleted,
  };
}
