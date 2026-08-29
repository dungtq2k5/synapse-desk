import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { RequestContext, RequestOrigin } from '@synapsedesk/common';
import { BillingGrpcClient } from './billing-grpc.client';
import { PlanChangeGuard } from './plan-change.guard';
import {
  toInvoiceResponseDtos,
  toPlanChangeResponseDto,
  toSubscriptionResponseDto,
  toTenantPlanResponseDtos,
} from './billing.mapper';
import {
  ChangePlanDto,
  CreateCheckoutSessionDto,
  CreatePortalSessionDto,
} from './dto/rest/billing.dto';
import {
  CheckoutSessionResponseDto,
  InvoiceResponseDto,
  PlanChangeResponseDto,
  PortalSessionResponseDto,
  SubscriptionResponseDto,
  TenantPlanResponseDto,
} from './dto/rest/billing-response.dto';

/** The gateway's billing surface. Returns REST DTOs; the wire stays in the client. */
@Injectable()
export class BillingService {
  constructor(
    private readonly billingGrpcClient: BillingGrpcClient,
    private readonly planChangeGuard: PlanChangeGuard,
  ) {}

  /**
   * Forwards Stripe's raw bytes and signature header for verification.
   *
   * @returns The `BillingEventStatus` acted on, or `''` for an event type this
   * system ignores.
   */
  async handleStripeWebhook(
    payload: Buffer,
    signature: string,
    origin: RequestOrigin,
  ): Promise<{ status: string }> {
    const { status } = await this.billingGrpcClient.handleStripeWebhook(
      payload,
      signature,
      origin,
    );

    return { status };
  }

  async getSubscription(
    context: RequestContext,
  ): Promise<SubscriptionResponseDto> {
    return toSubscriptionResponseDto(
      await this.billingGrpcClient.getSubscription(context),
    );
  }

  createCheckoutSession(
    dto: CreateCheckoutSessionDto,
    context: RequestContext,
  ): Promise<CheckoutSessionResponseDto> {
    return this.billingGrpcClient.createCheckoutSession(dto, context);
  }

  createPortalSession(
    dto: CreatePortalSessionDto,
    context: RequestContext,
  ): Promise<PortalSessionResponseDto> {
    return this.billingGrpcClient.createPortalSession(dto, context);
  }

  async listInvoices(
    limit: number | undefined,
    context: RequestContext,
  ): Promise<InvoiceResponseDto[]> {
    return toInvoiceResponseDtos(
      await this.billingGrpcClient.listInvoices(limit, context),
    );
  }

  async listPlans(context: RequestContext): Promise<TenantPlanResponseDto[]> {
    return toTenantPlanResponseDtos(
      await this.billingGrpcClient.listTenantPlans(context),
    );
  }

  /**
   * Move the workspace to another catalogue plan.
   *
   * **Three steps, and the middle one is why this is not a single RPC.** Auth
   * runs every refusal it can and reports which dimensions narrow; the gateway
   * verifies the ones ingestion owns; auth then executes. Auth cannot do the
   * middle step — ingestion dials auth on every presign, so the reverse edge
   * would close a cycle on the identity leaf — and the gateway must not do the
   * first, because the seat count that decides a refusal has to be the one that
   * refuses the tenant's next invitation.
   *
   * **The block runs BEFORE Stripe is touched.** Running it afterwards would
   * mean refusing a change that has already been made and invoiced.
   *
   * @param idempotencyKey the caller's `Idempotency-Key`, forwarded so a retry
   *   collapses onto one Stripe update rather than a second proration invoice.
   */
  async changePlan(
    dto: ChangePlanDto,
    context: RequestContext,
    idempotencyKey?: string,
  ): Promise<PlanChangeResponseDto> {
    const preview = await this.billingGrpcClient.previewPlanChange(
      { planId: dto.planId, priceId: dto.priceId },
      context,
    );

    const verdict = await this.planChangeGuard.verify(preview, context);

    if (!verdict.allowed) {
      // **A gate may not degrade.** An unverifiable dimension is a refusal, not
      // an allow with that dimension unchecked — the opposite of what the
      // plan-apply composer does with the same leg, and deliberately so.
      if (verdict.reason === 'unverifiable') {
        throw new ServiceUnavailableException(
          `Your ${verdict.dimensions.join(' and ')} usage could not be checked just now — please try again shortly`,
        );
      }

      // Names what to reduce and by how much. The person who tried is reading
      // this, which is why it is a refusal rather than a notification.
      throw new BadRequestException(
        `This plan does not fit your current usage — ${verdict.overLimit.join('; ')}`,
      );
    }

    return toPlanChangeResponseDto(
      await this.billingGrpcClient.changePlan(
        { planId: dto.planId, priceId: dto.priceId, idempotencyKey },
        context,
      ),
    );
  }
}
