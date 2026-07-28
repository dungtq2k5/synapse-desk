import { PartialType, PickType } from '@nestjs/swagger';
import { UserBase } from '../base/user.base';

export class UpdateUserDto extends PartialType(
  PickType(UserBase, ['fullName', 'avatarUrl', 'phoneNumber', 'gender', 'dob']),
) {}
