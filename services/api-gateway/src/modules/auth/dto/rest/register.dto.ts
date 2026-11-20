import { NoEmoji } from '../../../../common/decorators/no-emoji.decorator';
import {
  MAX_FULL_NAME_LENGTH,
  MIN_FULL_NAME_LENGTH,
} from '../../../../common/config/dto.config';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { StrongPassword } from '../../../../common/decorators/published-validators.decorator';

export class RegisterDto {
  @IsEmail()
  readonly email!: string;

  @StrongPassword()
  readonly password!: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(MIN_FULL_NAME_LENGTH)
  @MaxLength(MAX_FULL_NAME_LENGTH)
  @NoEmoji()
  readonly fullName!: string;
}
