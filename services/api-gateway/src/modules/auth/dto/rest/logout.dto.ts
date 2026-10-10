import { IsBoolean, IsOptional } from 'class-validator';

export class LogoutDto {
  /** Log out of all devices. */
  @IsOptional()
  @IsBoolean()
  readonly allDevices?: boolean;
}
