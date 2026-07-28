import { Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsUUID } from 'class-validator';

export class RegisterResponseDto {
  @IsUUID()
  readonly userId!: string;

  @IsUUID()
  readonly organizationId!: string;

  @IsEmail()
  readonly email!: string;

  @Type(() => Boolean)
  @IsBoolean()
  readonly requiresEmailVerification!: boolean;
}
