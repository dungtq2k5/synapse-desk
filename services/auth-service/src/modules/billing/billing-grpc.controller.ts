import { Controller } from '@nestjs/common';
import type { Metadata } from '@grpc/grpc-js';
import {
  BillingEmptyRequest,
  BillingServiceController,
  BillingServiceControllerMethods,
  CheckoutSessionResponse,
  CreateCheckoutSessionRequest,
  CreatePortalSessionRequest,
  ListInvoicesRequest,
  ListInvoicesResponse,
  ListTenantPlansResponse,
  PlanChangePreviewResponse,
  PlanChangeRequest,
  PlanChangeResponse,
  PortalSessionResponse,
  StripeWebhookRequest,
  StripeWebhookResponse,
  SubscriptionResponse,
  unpackCallerContext,
} from '@synapsedesk/grpc-proto';
import { BillingService } from './billing.service';
import { PlanChangeService } from './plan-change.service';
import { EntitlementWriterService } from './entitlement-writer.service';

@Controller()
@BillingServiceControllerMethods()
export class BillingGrpcController implements BillingServiceController {
  constructor(
    private readonly billing: BillingService,
    private readonly writer: EntitlementWriterService,
    private readonly planChange: PlanChangeService,
  ) {}

  /**
   * The webhook. **Reads no caller context at all**, and that is the point.
   *
   * There is no JWT: the request is authenticated by Stripe's signature over
   * the raw bytes, which is a STRONGER claim than a bearer token rather than a
   * weaker one. The tenant is resolved from the payload, so there is no tenant
   * context to scope by either — and an unresolvable customer is stored with
   * `organization_id = NULL` rather than dropped.
   */
  async handleStripeWebhook(
    request: StripeWebhookRequest,
  ): Promise<StripeWebhookResponse> {
    const outcome = await this.writer.handle(
      Buffer.from(request.payload),
      request.signature,
    );

    return {
      status: outcome.status,
      billingEventId: outcome.billingEventId,
    };
  }

  getSubscription(
    _request: BillingEmptyRequest,
    metadata?: Metadata,
  ): Promise<SubscriptionResponse> {
    return this.billing.getSubscription(unpackCallerContext(metadata));
  }

  createCheckoutSession(
    request: CreateCheckoutSessionRequest,
    metadata?: Metadata,
  ): Promise<CheckoutSessionResponse> {
    return this.billing.createCheckoutSession(
      request,
      unpackCallerContext(metadata),
    );
  }

  createPortalSession(
    request: CreatePortalSessionRequest,
    metadata?: Metadata,
  ): Promise<PortalSessionResponse> {
    return this.billing.createPortalSession(
      request,
      unpackCallerContext(metadata),
    );
  }

  listInvoices(
    request: ListInvoicesRequest,
    metadata?: Metadata,
  ): Promise<ListInvoicesResponse> {
    return this.billing.listInvoices(request, unpackCallerContext(metadata));
  }

  listTenantPlans(
    _request: BillingEmptyRequest,
    metadata?: Metadata,
  ): Promise<ListTenantPlansResponse> {
    return this.planChange.listTenantPlans(unpackCallerContext(metadata));
  }

  previewPlanChange(
    request: PlanChangeRequest,
    metadata?: Metadata,
  ): Promise<PlanChangePreviewResponse> {
    return this.planChange.previewPlanChange(
      request,
      unpackCallerContext(metadata),
    );
  }

  changePlan(
    request: PlanChangeRequest,
    metadata?: Metadata,
  ): Promise<PlanChangeResponse> {
    return this.planChange.changePlan(request, unpackCallerContext(metadata));
  }
}
