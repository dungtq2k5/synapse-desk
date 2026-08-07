/**
 * Enumerations owned by the auth flows — invitation lifecycle, OTP purpose, and
 * the profile's gender field.
 *
 * Each mirrors a `VarChar` column rather than a Postgres enum, per
 * development-conventions §7.3.
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
  EMAIL_VERIFICATION = 'email_verification',
  PHONE_VERIFICATION = 'phone_verification',
}
export const OTP_PURPOSES = [
  OtpPurpose.EMAIL_VERIFICATION,
  OtpPurpose.PHONE_VERIFICATION,
] as const;
