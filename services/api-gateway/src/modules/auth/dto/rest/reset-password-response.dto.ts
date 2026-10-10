/** What the password reset and change routes return. */

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

export class ChangePasswordResponseDto {
  /** Other devices signed out by the change. The caller keeps this session. */
  readonly revokedSessionCount!: number;
}
