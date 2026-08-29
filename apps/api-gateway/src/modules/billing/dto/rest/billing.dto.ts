import {
  STRIPE_REDIRECT_URL,
  MAX_BILLING_PRICE_ID_LENGTH,
} from '../../../../common/config/dto.config';
import { IsString, IsUrl, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateCheckoutSessionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_BILLING_PRICE_ID_LENGTH)
  priceId!: string;

  @IsUrl(STRIPE_REDIRECT_URL)
  successUrl!: string;

  @IsUrl(STRIPE_REDIRECT_URL)
  cancelUrl!: string;
}

export class CreatePortalSessionDto {
  @IsUrl(STRIPE_REDIRECT_URL)
  returnUrl!: string;
}

export class ChangePlanDto {
  @IsUUID('4')
  planId!: string;

  /**
   * Both ids, and they must agree.
   *
   * Sending only the price would let a caller name Pro's plan and Starter's
   * price; sending only the plan would charge them for a price the plan does
   * not own. The endpoint refuses a mismatch rather than picking one.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_BILLING_PRICE_ID_LENGTH)
  priceId!: string;
}
