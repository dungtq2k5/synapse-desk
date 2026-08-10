import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  AUTH_GRPC_CLIENT,
  BILLING_SERVICE_NAME,
  BillingServiceClient,
  requireProtoTimestamp,
  fromProtoAiModelTier,
  fromProtoOrgStatus,
} from '@synapsedesk/grpc-proto';
import { RequestContext, RequestOrigin } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';
import {
  CreateCheckoutSessionDto,
  CreatePortalSessionDto,
} from './dto/rest/billing.dto';
import {
  CheckoutSessionResponseDto,
  InvoiceResponseDto,
  PortalSessionResponseDto,
  SubscriptionResponseDto,
} from './dto/rest/billing-response.dto';

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
  ): Promise<{ status: string }> {
    const response = await this.call(
      (metadata) =>
        this.billingGrpcService.handleStripeWebhook(
          { payload, signature },
          metadata,
        ),
      origin,
      STRIPE_DEADLINE_MS,
    );

    return { status: response.status };
  }

  async getSubscription(
    context: RequestContext,
  ): Promise<SubscriptionResponseDto> {
    const response = await this.call(
      (metadata) => this.billingGrpcService.getSubscription({}, metadata),
      context,
    );

    return {
      stripeCustomerId: response.stripeCustomerId ?? null,
      stripeSubscriptionId: response.stripeSubscriptionId ?? null,
      planName: response.planName,
      maxAgentSeats: response.maxAgentSeats,
      maxStorageBytes: response.maxStorageBytes,
      monthlyAiTokenBudget: response.monthlyAiTokenBudget,
      aiModelTier: fromProtoAiModelTier(response.aiModelTier) ?? '',
      billingCycleStart: requireProtoTimestamp(
        response.billingCycleStart,
        'billingCycleStart',
      ),
      status: fromProtoOrgStatus(response.status) ?? '',
    };
  }

  createCheckoutSession(
    dto: CreateCheckoutSessionDto,
    context: RequestContext,
  ): Promise<CheckoutSessionResponseDto> {
    return this.call(
      (metadata) =>
        this.billingGrpcService.createCheckoutSession(dto, metadata),
      context,
      STRIPE_DEADLINE_MS,
    );
  }

  createPortalSession(
    dto: CreatePortalSessionDto,
    context: RequestContext,
  ): Promise<PortalSessionResponseDto> {
    return this.call(
      (metadata) => this.billingGrpcService.createPortalSession(dto, metadata),
      context,
      STRIPE_DEADLINE_MS,
    );
  }

  async listInvoices(
    limit: number | undefined,
    context: RequestContext,
  ): Promise<InvoiceResponseDto[]> {
    const response = await this.call(
      (metadata) =>
        this.billingGrpcService.listInvoices({ limit: limit ?? 0 }, metadata),
      context,
      STRIPE_DEADLINE_MS,
    );

    return response.items.map((invoice) => ({
      id: invoice.id,
      number: invoice.number,
      amountDue: invoice.amountDue,
      currency: invoice.currency,
      status: invoice.status,
      created: requireProtoTimestamp(invoice.created, 'created'),
      hostedInvoiceUrl: invoice.hostedInvoiceUrl,
    }));
  }
}
