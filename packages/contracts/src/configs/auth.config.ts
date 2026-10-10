/**
 * @file Enumerations and bounds owned by the auth flows — invitation lifecycle,
 * OTP purpose, the profile's gender field and what a profile picture may be.
 *
 * Each mirrors a `VarChar` column rather than a Postgres enum, per
 * `development-conventions.md §7.3`.
 */

import type { MimeType } from './mime.config';

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

/**
 * What may be stored as a user AVATAR.
 *
 * **The single definition.** `PURPOSE_POLICY[AVATAR]` in storage-service imports
 * this rather than restating it, so the gateway's check and storage's check read
 * one list — two layers, one vocabulary.
 *
 * **No SVG**, and it is the one exclusion worth naming: an SVG is a document
 * that can carry script, so it is the single image type that behaves like an
 * executable when served.
 */
export const AVATAR_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const satisfies readonly MimeType[];
export type AvatarMimeType = (typeof AVATAR_MIME_TYPES)[number];

/**
 * The largest an avatar may be.
 *
 * **The single definition**, beside {@link AVATAR_MIME_TYPES} for the same
 * reason: the gateway's presign DTO bounds it with `@Max` before a network hop,
 * and `PURPOSE_POLICY[AVATAR]` bounds the object itself. Two layers, one number.
 */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
