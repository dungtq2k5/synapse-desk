import { PartialType, PickType } from '@nestjs/swagger';
import { UserBase } from '../base/user.base';

export class UpdateUserDto extends PartialType(
  PickType(UserBase, ['fullName', 'avatarUrl', 'phoneNumber', 'gender', 'dob']),
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
  PickType(UserBase, ['fullName', 'avatarUrl', 'gender', 'dob']),
) {}
