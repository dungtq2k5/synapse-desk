import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Headers,
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
import { BillingService } from './billing.service';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AUTH_SCHEMES } from '../../common/config/swagger.config';
import {
  ApiFilterErrors,
  ApiWrappedResponse,
} from '../../common/decorators/api-response.decorator';
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
  constructor(private readonly billing: BillingService) {}

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

  /**
   * The plans this workspace may move to.
   *
   * **Not the Super Admin catalogue behind a looser guard.** That projection
   * carries `stripeProductId`, subscriber counts, `deletedAt` and `isActive`;
   * this one carries the name, the grants and the prices. Reusing the operator
   * DTO is how those fields leak.
   *
   * Filtered to joinable plans by the SAME filter `POST /billing/plan` refuses
   * on — one definition, or the UI offers a plan the endpoint rejects.
   */
  @ApiOperation({ summary: 'Plans this workspace can move to' })
  @ApiWrappedResponse(TenantPlanResponseDto, { isArray: true })
  @ApiFilterErrors(['401', '403'])
  @Get('plans')
  @RequirePermission('organization.read')
  listPlans(
    @CurrentUser() context: RequestContext,
  ): Promise<TenantPlanResponseDto[]> {
    return this.billing.listPlans(context);
  }

  /**
   * Move to another plan, unless current usage does not fit it.
   *
   * `organization.update` — the same permission as starting a subscription,
   * because the person who can start one can change one.
   *
   * **The refusal is a 400 naming the dimensions and the numbers**, and that is
   * the whole reason this route exists rather than Stripe's portal: a change
   * made inside Stripe's UI reaches this system only after Stripe has applied
   * it, which is too late to refuse. `503` when a usage leg cannot be read — a
   * gate that fails open is not a gate.
   *
   * **Entitlements are NOT written here.** They are written when
   * `customer.subscription.updated` arrives, exactly as for checkout.
   *
   * `Idempotency-Key` is honoured: `always_invoice` means a retried request is
   * a second proration invoice, so the header is forwarded to Stripe's own
   * idempotency. Without one a derived key still collapses a double-click.
   */
  @ApiOperation({ summary: 'Change the workspace plan' })
  @ApiWrappedResponse(PlanChangeResponseDto)
  @ApiFilterErrors(['400', '401', '403', '404', '409', '503'])
  @Post('plan')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('organization.update')
  @ResponseMessage('Plan change submitted')
  changePlan(
    @CurrentUser() context: RequestContext,
    @Body() dto: ChangePlanDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<PlanChangeResponseDto> {
    return this.billing.changePlan(dto, context, idempotencyKey);
  }
}
