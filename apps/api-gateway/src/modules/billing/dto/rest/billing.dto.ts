import { IsString, IsUrl, MaxLength, MinLength } from 'class-validator';

/**
 * The validation every Stripe redirect URL in this file gets.
 *
 * All three fields are the same thing — a URL we hand to Stripe, which Stripe
 * later hands to a BROWSER — so they share one rule rather than three copies
 * that can drift. A copy that lost `protocols` would still look like
 * validation while accepting `javascript:` or `data:`, and nothing at the call
 * site would show the difference.
 *
 * `require_tld: false` so a `localhost` redirect works in development. The
 * PROTOCOL restriction is the part that matters, and the part that must not be
 * relaxed for convenience.
 */
const STRIPE_REDIRECT_URL = {
  require_tld: false,
  protocols: ['http', 'https'],
};

export class CreateCheckoutSessionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
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
