import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsStrongPassword,
} from 'class-validator';

export class RegisterDto {
  @IsEmail()
  readonly email!: string;

  @IsStrongPassword()
  readonly password!: string;

  @IsNotEmpty()
  @IsString()
  readonly fullName!: string;
}
