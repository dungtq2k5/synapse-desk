import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  AUTH_GRPC_CLIENT,
  BILLING_SERVICE_NAME,
  BillingServiceClient,
  CheckoutSessionResponse,
  CreateCheckoutSessionRequest,
  CreatePortalSessionRequest,
  ListInvoicesResponse,
  ListTenantPlansResponse,
  PlanChangePreviewResponse,
  PlanChangeRequest,
  PlanChangeResponse,
  PortalSessionResponse,
  StripeWebhookResponse,
  SubscriptionResponse,
} from '@synapsedesk/grpc-proto';
import { RequestContext, RequestOrigin } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';

/**
 * Stripe's own API is slow enough that the shared 5-second deadline turns an
 * ordinary checkout into a 504. Longer here, and only here — the local reads on
 * this client keep the default by using `call` without an override.
 */
const STRIPE_DEADLINE_MS = 20_000;

@Injectable()
export class BillingGrpcClient extends BaseGrpcClient implements OnModuleInit {
  protected readonly serviceName = 'auth-service';

  private billingGrpcService!: BillingServiceClient;

  constructor(@Inject(AUTH_GRPC_CLIENT) private readonly client: ClientGrpc) {
    super();
  }

  onModuleInit(): void {
    this.billingGrpcService =
      this.client.getService<BillingServiceClient>(BILLING_SERVICE_NAME);
  }

  /**
   * Forwards the RAW BYTES and the signature header.
   *
   * Takes a bare `RequestOrigin` rather than a `RequestContext` because there
   * is no authenticated caller — Stripe's signature is the credential, and it
   * is verified in auth-service where the secret lives. The gateway is a pipe
   * that cannot forge an entitlement change.
   */
  async handleStripeWebhook(
    payload: Buffer,
    signature: string,
    origin: RequestOrigin,
  ): Promise<StripeWebhookResponse> {
    return this.call(
      (metadata) =>
        this.billingGrpcService.handleStripeWebhook(
          { payload, signature },
          metadata,
        ),
      origin,
      STRIPE_DEADLINE_MS,
    );
  }

  getSubscription(context: RequestContext): Promise<SubscriptionResponse> {
    return this.call(
      (metadata) => this.billingGrpcService.getSubscription({}, metadata),
      context,
    );
  }

  createCheckoutSession(
    request: CreateCheckoutSessionRequest,
    context: RequestContext,
  ): Promise<CheckoutSessionResponse> {
    return this.call(
      (metadata) =>
        this.billingGrpcService.createCheckoutSession(request, metadata),
      context,
      STRIPE_DEADLINE_MS,
    );
  }

  createPortalSession(
    request: CreatePortalSessionRequest,
    context: RequestContext,
  ): Promise<PortalSessionResponse> {
    return this.call(
      (metadata) =>
        this.billingGrpcService.createPortalSession(request, metadata),
      context,
      STRIPE_DEADLINE_MS,
    );
  }

  listInvoices(
    limit: number | undefined,
    context: RequestContext,
  ): Promise<ListInvoicesResponse> {
    return this.call(
      (metadata) =>
        this.billingGrpcService.listInvoices({ limit: limit ?? 0 }, metadata),
      context,
      STRIPE_DEADLINE_MS,
    );
  }

  listTenantPlans(context: RequestContext): Promise<ListTenantPlansResponse> {
    return this.call(
      (metadata) => this.billingGrpcService.listTenantPlans({}, metadata),
      context,
    );
  }

  /** Local reads only — no Stripe call, so the default deadline applies. */
  previewPlanChange(
    request: PlanChangeRequest,
    context: RequestContext,
  ): Promise<PlanChangePreviewResponse> {
    return this.call(
      (metadata) =>
        this.billingGrpcService.previewPlanChange(request, metadata),
      context,
    );
  }

  changePlan(
    request: PlanChangeRequest,
    context: RequestContext,
  ): Promise<PlanChangeResponse> {
    return this.call(
      (metadata) => this.billingGrpcService.changePlan(request, metadata),
      context,
      STRIPE_DEADLINE_MS,
    );
  }
}
