import { Type } from 'class-transformer';
import { Equals, IsBoolean, IsNotEmpty, IsString } from 'class-validator';

export class TwoFactorLoginResponseDto {
  @IsNotEmpty()
  @IsString()
  readonly twoFactorToken!: string;

  @Type(() => Boolean)
  @IsBoolean()
  @Equals(true)
  readonly requiresTwoFactor!: true;
}
