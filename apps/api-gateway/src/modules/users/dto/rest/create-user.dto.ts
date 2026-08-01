import { PickType } from '@nestjs/swagger';
import { UserBase } from '../base/user.base';
import {
  IsDate,
  IsOptional,
  IsPhoneNumber,
  IsUrl,
  IsUUID,
} from 'class-validator';
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

  @IsOptional()
  @IsNullable()
  @IsUrl()
  readonly avatarUrl?: string | null;

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
