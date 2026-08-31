import {
  fromProtoTimestamp,
  requireProtoTimestamp,
  type FinanceSnapshotResponse,
  type ListBillingEventsResponse,
} from '@synapsedesk/grpc-proto';
import type {
  BillingEventsResponseDto,
  FinanceRevenueResponseDto,
  FinanceSnapshotResponseDto,
} from './dto/rest/finance-response.dto';

/**
 * `FinanceSnapshotResponse` off the wire into its REST DTO.
 *
 * **Every optional becomes an explicit `null`**, matching
 * `UsageMeterResponseDto`. The proto uses `optional` because a degraded section
 * genuinely has no number; the REST shape says so with `null` rather than by
 * omitting the key, so a client destructuring the object gets the same fields
 * whichever branch it is in.
 *
 * @throws Error if `generatedAt` is missing, which the proto requires.
 */
export function toFinanceSnapshotResponseDto(
  response: FinanceSnapshotResponse,
): FinanceSnapshotResponseDto {
  return {
    tenants: {
      total: response.tenants?.total ?? 0,
      byStatus: response.tenants?.byStatus ?? {},
    },
    plans: response.plans.map((plan) => ({
      planId: plan.planId,
      planName: plan.planName,
      subscribers: plan.subscribers,
      seatsAllocated: plan.seatsAllocated,
    })),
    dunning: {
      pastDue: response.dunning?.pastDue ?? 0,
      tenants: (response.dunning?.tenants ?? []).map((tenant) => ({
        id: tenant.id,
        name: tenant.name,
        updatedAt: requireProtoTimestamp(tenant.updatedAt, 'updatedAt'),
      })),
    },
    revenue: toFinanceRevenueResponseDto(response.revenue),
    generatedAt: requireProtoTimestamp(response.generatedAt, 'generatedAt'),
  };
}

/**
 * The revenue section, degraded or not.
 *
 * A missing `revenue` message is treated as unavailable rather than thrown on:
 * three of the four sections are local and exact, and failing the whole
 * response because the optional one is malformed is the coupling the two RPCs
 * were split to avoid.
 */
function toFinanceRevenueResponseDto(
  revenue: FinanceSnapshotResponse['revenue'],
): FinanceRevenueResponseDto {
  return {
    available: revenue?.available ?? false,
    unavailableReason: revenue?.unavailableReason ?? null,
    estimatedMrr: revenue?.estimatedMrr ?? null,
    currency: revenue?.currency ?? null,
    activeSubscriptions: revenue?.activeSubscriptions ?? null,
    computedAt: fromProtoTimestamp(revenue?.computedAt) ?? null,
    // Present on every response, including the degraded ones. A caveat the
    // client renders beside the section heading must not disappear in the
    // branch where the number is missing, or it teaches the reader it is
    // optional.
    excludes: revenue?.excludes ?? [],
  };
}

/** The time series, which has no optional fields and cannot degrade. */
export function toBillingEventsResponseDto(
  response: ListBillingEventsResponse,
): BillingEventsResponseDto {
  return {
    points: response.points,
    currentlyOffboarded: response.currentlyOffboarded,
    observedEventTypes: response.observedEventTypes,
  };
}
