import {
  MAX_FULL_NAME_LENGTH,
  MIN_FULL_NAME_LENGTH,
} from '../../../../common/config/dto.config';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsStrongPassword,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsEmail()
  readonly email!: string;

  @IsStrongPassword()
  readonly password!: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(MIN_FULL_NAME_LENGTH)
  @MaxLength(MAX_FULL_NAME_LENGTH)
  readonly fullName!: string;
}

export class RegisterResponseDto {
  readonly userId!: string;

  readonly organizationId!: string;

  readonly email!: string;

  readonly requiresEmailVerification!: boolean;
}
