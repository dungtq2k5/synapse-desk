import {
  Equals,
  IsBoolean,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from 'class-validator';
import { UserResponseDto } from '../../../users/dto/rest/user-response.dto';
import { Type } from 'class-transformer';

export class LoginResponseDto {
  @IsNotEmpty()
  @IsString()
  // TODO Will also be set within the cookie
  readonly accessToken!: string;

  @IsNotEmpty()
  @IsString()
  // TODO Will also be set within the cookie
  readonly refreshToken!: string;

  @Type(() => UserResponseDto)
  @ValidateNested()
  readonly user!: UserResponseDto;

  @Type(() => Boolean)
  @IsBoolean()
  @Equals(false)
  readonly requiresTwoFactor!: false;
}
