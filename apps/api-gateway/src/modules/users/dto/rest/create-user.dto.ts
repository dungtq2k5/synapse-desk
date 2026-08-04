import { PickType } from '@nestjs/swagger';
import { UserBase } from '../base/user.base';
import { IsDate, IsOptional, IsPhoneNumber, IsUUID } from 'class-validator';
import { IsNullable } from '../../../../common/decorators/is-nullable.decorator';
import { Type } from 'class-transformer';

export class CreateUserDto extends PickType(UserBase, [
  'organizationId',
  'fullName',
  'email',
  'gender',
]) {
  @IsOptional()
  @IsNullable()
  @IsUUID()
  readonly departmentId?: string | null;

  // No `avatarUrl`. CreateUserRequest has no such field, so this accepted a URL
  // and silently discarded it — and a new user has nothing to show an avatar
  // for yet anyway. It arrives through the avatar confirm endpoint.

  @IsOptional()
  @IsNullable()
  @IsPhoneNumber()
  readonly phoneNumber?: string | null;

  @Type(() => Date)
  @IsOptional()
  @IsNullable()
  @IsDate()
  readonly dob?: Date | null;
}
