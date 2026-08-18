import { Injectable } from '@nestjs/common';
import { RequestContext, RequestOrigin } from '@synapsedesk/common';
import { BillingGrpcClient } from './billing-grpc.client';
import {
  toInvoiceResponseDtos,
  toSubscriptionResponseDto,
} from './billing.mapper';
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

/** The gateway's billing surface. Returns REST DTOs; the wire stays in the client. */
@Injectable()
export class BillingService {
  constructor(private readonly billingGrpcClient: BillingGrpcClient) {}

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
}
