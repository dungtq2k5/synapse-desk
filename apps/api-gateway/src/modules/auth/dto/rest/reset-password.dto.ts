import { IsNotEmpty, IsString, IsStrongPassword } from 'class-validator';

export class ResetPasswordDto {
  @IsNotEmpty()
  @IsString()
  readonly token!: string;

  @IsString()
  @IsStrongPassword()
  readonly newPassword!: string;
}

/**
 * Pre-flight result for the reset form, so the UI can show "this link has
 * expired" before the user types a new password into a dead form.
 *
 * `email` is masked (`a***e@acme.com`): a stolen token must not become a way to
 * read addresses out of the database.
 */
export class ValidatePasswordResetTokenResponseDto {
  readonly valid!: boolean;
  readonly email!: string | null;
}

export class ResetPasswordResponseDto {
  /** Surfaced so the UI can say "you have been signed out of N devices". */
  readonly revokedSessionCount!: number;
}

/**
 * Changing a password you KNOW, as opposed to resetting one you have forgotten.
 *
 * `currentPassword` is the whole security value of this endpoint: without it a
 * hijacked session could be turned into permanent account takeover. It is
 * verified server-side and never trusted from the client.
 */
export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  readonly currentPassword!: string;

  // Same strength rule as the reset flow. Applying a weaker one here would let
  // a user downgrade a password that the reset form would have rejected.
  @IsString()
  @IsStrongPassword()
  readonly newPassword!: string;
}

export class ChangePasswordResponseDto {
  /** Other devices signed out by the change. The caller keeps this session. */
  readonly revokedSessionCount!: number;
}
