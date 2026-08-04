import { PartialType, PickType } from '@nestjs/swagger';
import { UserBase } from '../base/user.base';

/**
 * `avatarUrl` is absent here and on UpdateOwnProfileDto, and that absence is
 * enforcement: with `forbidNonWhitelisted`, sending it is a 400. The column is
 * written only by `POST /users/me/avatar/confirm`, which is what proves the
 * object was really uploaded by this caller and what deletes the one it
 * replaces. Accepting a raw string here would skip both.
 */
export class UpdateUserDto extends PartialType(
  PickType(UserBase, ['fullName', 'phoneNumber', 'gender', 'dob']),
) {}

/**
 * Own profile (`PATCH /users/me`).
 *
 * Narrower than UpdateUserDto on purpose: `phoneNumber` is absent because
 * changing it goes through the OTP flow that already exists (`otps.target` was
 * designed for exactly this), and `email`/`isEmailVerified`/`isLocked`/roles/
 * departments are administrative.
 *
 * `forbidNonWhitelisted` in the global ValidationPipe turns an attempt at any
 * of them into a 400 automatically — which is the DTO doing security work, so
 * keeping it narrow is the enforcement, not documentation of it.
 */
export class UpdateOwnProfileDto extends PartialType(
  PickType(UserBase, ['fullName', 'gender', 'dob']),
) {}
