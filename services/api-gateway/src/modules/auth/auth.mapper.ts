import {
  LoginResponse as ProtoLoginResponse,
  RefreshTokenResponse,
  RegisterResponse,
  requireField,
  ValidatePasswordResetTokenResponse,
} from '@synapsedesk/grpc-proto';
import { toUserResponseDto } from '../users/user.mapper';
import { UserResponseDto } from '../users/dto/rest/user-response.dto';
import { TenantOptionResponseDto } from './dto/rest/login-response.dto';
import { RegisterResponseDto } from './dto/rest/register-response.dto';
import { ValidatePasswordResetTokenResponseDto } from './dto/rest/reset-password-response.dto';

/**
 * Result of a login, discriminated exactly as the proto is.
 *
 * THREE shapes, and callers must branch on `requiresTenantSelection` FIRST:
 * 2FA policy is a per-tenant setting, so it cannot be evaluated until the
 * tenant is known.
 */
export type LoginResult =
  | {
      requiresTenantSelection: true;
      tenantSelectionToken: string;
      tenants: TenantOptionResponseDto[];
    }
  | {
      requiresTenantSelection: false;
      requiresTwoFactor: true;
      /**
       * The challenge is an ENROLMENT one: the tenant requires 2FA and this
       * account has none yet, so the client must open setup rather than prompt
       * for a code that does not exist.
       */
      requiresTwoFactorSetup: boolean;
      twoFactorToken: string;
    }
  | {
      requiresTenantSelection: false;
      requiresTwoFactor: false;
      user: UserResponseDto;
      accessToken: string;
      refreshToken: string;
    };

/**
 * The proto's three-way union, unpacked once so every caller of `login` and
 * `googleSignIn` branches identically instead of re-deriving the precedence.
 */
export function toLoginResult(response: ProtoLoginResponse): LoginResult {
  if (response.requiresTenantSelection) {
    return {
      requiresTenantSelection: true,
      tenantSelectionToken: response.tenantSelectionToken ?? '',
      tenants: response.tenants.map((tenant) => ({
        organizationId: tenant.organizationId,
        name: tenant.name,
        slug: tenant.slug,
      })),
    };
  }

  if (response.requiresTwoFactor) {
    return {
      requiresTenantSelection: false,
      requiresTwoFactor: true,
      requiresTwoFactorSetup: response.requiresTwoFactorSetup,
      twoFactorToken: response.twoFactorToken ?? '',
    };
  }

  return {
    requiresTenantSelection: false,
    requiresTwoFactor: false,
    user: toUserResponseDto(requireField(response.user, 'user')),
    accessToken: response.accessToken ?? '',
    refreshToken: response.refreshToken ?? '',
  };
}

/** What a refresh returns: the user plus the rotated pair. */
export type RefreshResult = {
  user: UserResponseDto;
  accessToken: string;
  refreshToken: string;
};

/** Converts a `RegisterResponse` off the wire into its REST DTO. */
export function toRegisterResponseDto(
  response: RegisterResponse,
): RegisterResponseDto {
  return {
    userId: response.userId,
    organizationId: response.organizationId,
    email: response.email,
    requiresEmailVerification: response.requiresEmailVerification,
  };
}

/**
 * Splits a `RefreshTokenResponse` into the user shape and the rotated tokens.
 *
 * @throws Error if the response carries no user, which the proto requires.
 */
export function toRefreshResult(response: RefreshTokenResponse): RefreshResult {
  return {
    user: toUserResponseDto(requireField(response.user, 'user')),
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
  };
}

/** Converts a `ValidatePasswordResetTokenResponse` into its REST DTO. */
export function toValidatePasswordResetTokenResponseDto(
  response: ValidatePasswordResetTokenResponse,
): ValidatePasswordResetTokenResponseDto {
  return { valid: response.valid, email: response.email ?? null };
}
