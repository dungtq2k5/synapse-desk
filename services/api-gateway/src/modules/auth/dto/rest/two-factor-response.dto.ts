/** What the two-factor routes return. */

import { UserResponseDto } from '../../../users/dto/rest/user-response.dto';

/**
 * The 2FA-challenge half of a login response.
 *
 * The short-lived 2FA token travels as a cookie, so this body exists only to
 * tell the SPA which screen to render next. A login answers either this or
 * `LoginResponseDto` — the union is expressible at the REST edge, where gRPC
 * carries one `LoginResponse` discriminated by `requires_two_factor`.
 */
export class TwoFactorRequiredResponseDto {
  readonly requiresTwoFactor!: true;

  /**
   * True when the tenant REQUIRES 2FA and this account has not enrolled.
   *
   * The client must branch on it: `false` means prompt for a code, `true` means
   * open the enrolment screen and call `POST /auth/2fa/setup` — which accepts
   * the challenge cookie precisely for this case. Showing a code box here would
   * ask for a code that does not exist yet, which is how a tenant-wide
   * `enforce_two_factor` becomes a tenant-wide lockout.
   */
  readonly requiresTwoFactorSetup!: boolean;
}

export class GenerateTwoFactorResponseDto {
  readonly otpauthUri!: string;
  readonly qrCodeDataUrl!: string;
}

export class BackupCodesResponseDto {
  /** Shown once. Only hashes are stored. */
  readonly backupCodes!: string[];
}

export class BackupCodesStatusResponseDto {
  readonly remaining!: number;
  readonly used!: number;
  readonly expiresAt!: Date | null;
}

/** Same shape as a successful login, plus an optional low-codes warning. */
export class TwoFactorAuthenticatedResponseDto {
  readonly user!: UserResponseDto;

  readonly warning!: string | null;
}
