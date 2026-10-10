import { UserResponseDto } from '../../../users/dto/rest/user-response.dto';
import { TwoFactorRequiredResponseDto } from './two-factor-response.dto';

/** What the login routes return. */

/**
 * Successful login.
 *
 * Carries NO tokens. They are set as HttpOnly cookies by `JwtCookieService`,
 * which is the entire point of HttpOnly — echoing them into the body would
 * hand them straight back to any XSS on the page.
 */
export class LoginResponseDto {
  readonly user!: UserResponseDto;

  readonly requiresTwoFactor!: false;
}
/**
 * One tenant the caller may sign in to.
 *
 * Returned only after a password verified — see `TenantSelectionResponseDto`.
 */
export class TenantOptionResponseDto {
  readonly organizationId!: string;
  readonly name!: string;
  readonly slug!: string;
}
/**
 * One address + password matched accounts in more than one tenant, so the
 * caller must pick.
 *
 * Carries NO tokens: nothing is issued until a tenant is chosen, because 2FA
 * policy is per-tenant and therefore unanswerable until then. The
 * `tenantSelectionToken` rides in its own short-lived cookie, so this body only
 * tells the SPA which screen to render.
 */
export class TenantSelectionResponseDto {
  readonly requiresTenantSelection!: true;

  readonly tenants!: TenantOptionResponseDto[];
}

/**
 * Every shape `POST /auth/login`, `/auth/login/tenant` and `/auth/google` can
 * return.
 *
 * Named once and reused, because all three endpoints plus `settleLogin` share
 * it — spelling the union out at each site invites one of them to drift when a
 * fourth branch appears, and a controller returning a subtly different union
 * from the helper that builds it compiles fine while lying to the client.
 *
 * Clients discriminate in this order: `requiresTenantSelection`, then
 * `requiresTwoFactor`. Tenant first, because 2FA policy is per-tenant and
 * therefore unanswerable until the tenant is known.
 */
export type LoginOutcomeDto =
  LoginResponseDto | TwoFactorRequiredResponseDto | TenantSelectionResponseDto;
