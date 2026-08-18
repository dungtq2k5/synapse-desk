/**
 * @file Enumerations owned by the auth flows — invitation lifecycle, OTP purpose, and
 * the profile's gender field.
 *
 * Each mirrors a `VarChar` column rather than a Postgres enum, per
 * `development-conventions.md §7.3`.
 */

export enum Gender {
  UNSPECIFIED = 'UNSPECIFIED',
  MALE = 'MALE',
  FEMALE = 'FEMALE',
  OTHER = 'OTHER',
}

/** Mirrors the `invitation_status` Postgres enum. */
export enum InvitationStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REVOKED = 'REVOKED',
  EXPIRED = 'EXPIRED',
}

export enum OtpPurpose {
  EMAIL_VERIFICATION = 'EMAIL_VERIFICATION',
  PHONE_VERIFICATION = 'PHONE_VERIFICATION',
}
export const OTP_PURPOSES = [
  OtpPurpose.EMAIL_VERIFICATION,
  OtpPurpose.PHONE_VERIFICATION,
] as const;

/**
 * Shortest password any surface accepts.
 *
 * Shared because two services enforce it independently: the gateway validates
 * it on the invitation-accept body, and auth-service's Joi schema requires it
 * of `SUPER_ADMIN_PASSWORD`. Two copies of a password policy is one copy that
 * gets raised and one that does not.
 */
export const MIN_PASSWORD_LENGTH = 12;
