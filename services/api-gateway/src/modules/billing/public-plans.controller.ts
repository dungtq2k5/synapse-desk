import { Controller, Get } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrgAccess, RequestOrigin } from '@synapsedesk/contracts';
import { CurrentOrigin } from '../../common/decorators/current-origin.decorator';
import { OrgAccessKind } from '../../common/decorators/org-access.decorator';
import { AuthThrottle } from '../../common/decorators/auth-throttle.decorator';
import {
  AUTH_THROTTLER_TIER,
  ROUTE_THROTTLE,
} from '../../common/config/throttler.config';
import {
  ApiFilterErrors,
  ApiWrappedResponse,
} from '../../common/decorators/api-response.decorator';
import { BillingService } from './billing.service';
import { TenantPlanResponseDto } from './dto/rest/billing-response.dto';

/**
 * `GET /billing/public-plans`: the price list anyone can read, for the landing
 * page's pricing.
 *
 * Its own controller because `BillingController` guards every route with a
 * session and a permission at the class level. Declared like the invitation
 * preview: no session scheme, no tenant, a per-address limit.
 */
@ApiTags('Billing')
@Controller('billing')
export class PublicPlansController {
  constructor(private readonly billing: BillingService) {}

  /**
   * Free, then the active plans with at least one price, by seats: what
   * anyone can actually get. Negotiated plans have no price, so they stay out.
   */
  @AuthThrottle()
  @Throttle({ [AUTH_THROTTLER_TIER]: ROUTE_THROTTLE.publicPlans })
  @OrgAccessKind(OrgAccess.AUTH)
  @ApiOperation({ summary: 'Plans anyone can get', security: [] })
  @ApiWrappedResponse(TenantPlanResponseDto, { isArray: true })
  @ApiFilterErrors([])
  @Get('public-plans')
  listPublicPlans(
    @CurrentOrigin() origin: RequestOrigin,
  ): Promise<TenantPlanResponseDto[]> {
    return this.billing.listPublicPlans(origin);
  }
}
