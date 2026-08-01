import { IsBoolean, IsOptional } from 'class-validator';

export class LogoutDto {
  /** "Log out of all devices" (RDM §1.5). */
  @IsOptional()
  @IsBoolean()
  readonly allDevices?: boolean;
}

export class LogoutResponseDto {
  readonly revokedSessionCount!: number;
}
