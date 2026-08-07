import { Type } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { UserResponseDto } from '../../../users/dto/rest/user-response.dto';
import { TwoFactorRequiredResponseDto } from './two-factor.dto';
import { MAX_DEVICE_NAME_LENGTH } from '../../../../common/config/dto.config';

export class LoginDto {
  @IsEmail()
  readonly email!: string;

  @IsNotEmpty()
  @IsString()
  readonly password!: string;

  /**
   * Display label for the "your active sessions" screen ("Chrome on macOS").
   *
   * That is its ONLY job, which is why it looks unused in `login()` today —
   * its destination is `device_sessions.device_name`, written when the session
   * row is created. Being client-supplied, it must never influence a security
   * decision: device trust is proven with the separate `deviceToken` cookie,
   * a secret the server issued.
   *
   * `@MaxLength(100)` mirrors `device_sessions.device_name VarChar(100)` —
   * without it an oversized value becomes a Postgres error on insert rather
   * than a 400 at the edge.
   *
   * Optional rather than nullable: absent means "the client did not label this
   * device", and `undefined` is what the proto's `optional string` expects.
   *
   * There is deliberately no `ipAddress` field. A body field is whatever the
   * client says it is, so accepting one would let an attacker post
   * `{"ipAddress": "10.0.0.1"}` to poison the audit trail and evade IP-based
   * lockout. The gateway derives it from the transport (`req.ip`, honouring
   * `trust proxy`) and forwards it as gRPC metadata.
   */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_DEVICE_NAME_LENGTH)
  readonly deviceName?: string;
}

/**
 * Successful login.
 *
 * Carries NO tokens. They are set as HttpOnly cookies by `JwtCookieService`,
 * which is the entire point of HttpOnly — echoing them into the body would
 * hand them straight back to any XSS on the page.
 */
export class LoginResponseDto {
  @Type(() => UserResponseDto)
  @ValidateNested()
  readonly user!: UserResponseDto;

  readonly requiresTwoFactor!: false;
}

/**
 * One tenant the caller may sign in to.
 *
 * Returned only after a password verified — see `TenantSelectionResponseDto`.
 */
export class TenantOptionDto {
  @IsUUID()
  readonly organizationId!: string;

  @IsString()
  readonly name!: string;

  @IsString()
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

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TenantOptionDto)
  readonly tenants!: TenantOptionDto[];
}

/**
 * Second leg of a multi-tenant login.
 *
 * `organizationId` is accepted from the body here, which looks like it breaks
 * the "never trust the client for tenancy" rule — it does not. auth-service
 * only honours it when it appears in the tenant-selection token's verified set,
 * so it selects among already-proven options rather than asserting one.
 */
export class LoginWithTenantDto {
  @IsUUID()
  readonly organizationId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_DEVICE_NAME_LENGTH)
  readonly deviceName?: string;
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
