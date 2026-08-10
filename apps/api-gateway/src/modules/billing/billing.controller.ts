import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RequestContext, OrgAccess } from '@synapsedesk/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { OrgAccessKind } from '../../common/decorators/org-access.decorator';
import { BillingGrpcClient } from './billing-grpc.client';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AUTH_SCHEMES } from '../../common/config/swagger.config';
import {
  ApiFilterErrors,
  ApiWrappedResponse,
} from '../../common/decorators/api-response.decorator';
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
 * `/billing` — api-endpoints-plan §1.9.
 *
 * **`OrgAccess.BILLING` on every route**, which is what makes this surface
 * usable by the tenant that most needs it: a `SUSPENDED_PAST_DUE` workspace can
 * reach billing and nothing else. A tenant locked out of the page where they
 * would pay their overdue invoice is a lockout with no exit.
 */
@ApiTags('Billing')
@ApiCookieAuth(AUTH_SCHEMES.access)
@Controller('billing')
@UseGuards(JwtAuthGuard, PermissionGuard)
@OrgAccessKind(OrgAccess.BILLING)
export class BillingController {
  constructor(private readonly billing: BillingGrpcClient) {}

  /**
   * Reads POSTGRES, and makes zero Stripe calls.
   *
   * A dashboard that fans out to a third party on every load fails when they
   * do — and this is the page a customer opens when something is already wrong.
   */
  @ApiOperation({
    summary: 'Current plan, status, period, and the entitlements it granted',
  })
  @ApiWrappedResponse(SubscriptionResponseDto)
  @ApiFilterErrors(['401', '403'])
  @Get('subscription')
  @RequirePermission('organization.read')
  getSubscription(
    @CurrentUser() context: RequestContext,
  ): Promise<SubscriptionResponseDto> {
    return this.billing.getSubscription(context);
  }

  /**
   * Returns a Stripe URL. **Writes no entitlements.**
   *
   * They are written when the webhook confirms. A user who closes the tab
   * mid-checkout must not end up upgraded, and a user who pays must not depend
   * on their browser making it back to a redirect.
   */
  @ApiOperation({ summary: 'Create checkout session' })
  @ApiWrappedResponse(CheckoutSessionResponseDto)
  @ApiFilterErrors(['400', '401', '403'])
  @Post('checkout-session')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('organization.update')
  @ResponseMessage('Checkout session created')
  createCheckoutSession(
    @CurrentUser() context: RequestContext,
    @Body() dto: CreateCheckoutSessionDto,
  ): Promise<CheckoutSessionResponseDto> {
    return this.billing.createCheckoutSession(dto, context);
  }

  /**
   * The Customer Portal — card updates, plan changes and cancellation.
   *
   * This replaces UI that would otherwise have to be built and kept correct
   * against Stripe's behaviour, which is most of the reason to use Stripe
   * rather than a payment processor.
   */
  @ApiOperation({ summary: 'Create portal session' })
  @ApiWrappedResponse(PortalSessionResponseDto)
  @ApiFilterErrors(['400', '401', '403'])
  @Post('portal-session')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('organization.update')
  @ResponseMessage('Portal session created')
  createPortalSession(
    @CurrentUser() context: RequestContext,
    @Body() dto: CreatePortalSessionDto,
  ): Promise<PortalSessionResponseDto> {
    return this.billing.createPortalSession(dto, context);
  }

  /** The one place a live Stripe read is correct — invoices are not mirrored. */
  @ApiOperation({ summary: 'Invoice history, proxied from Stripe and cached' })
  @ApiWrappedResponse(InvoiceResponseDto, { isArray: true })
  @ApiFilterErrors(['401', '403'])
  @Get('invoices')
  @RequirePermission('organization.update')
  listInvoices(
    @CurrentUser() context: RequestContext,
    @Query('limit') limit?: string,
  ): Promise<InvoiceResponseDto[]> {
    return this.billing.listInvoices(
      limit ? Number(limit) : undefined,
      context,
    );
  }
}
