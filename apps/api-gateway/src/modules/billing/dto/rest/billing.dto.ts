import {
  STRIPE_REDIRECT_URL,
  MAX_BILLING_PRICE_ID_LENGTH,
} from '../../../../common/config/dto.config';
import { IsString, IsUrl, MaxLength, MinLength } from 'class-validator';

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
