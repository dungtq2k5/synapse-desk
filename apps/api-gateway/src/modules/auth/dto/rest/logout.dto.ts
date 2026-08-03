import { IsBoolean, IsOptional } from 'class-validator';

export class LogoutDto {
  /** "Log out of all devices" (RDM). */
  @IsOptional()
  @IsBoolean()
  readonly allDevices?: boolean;
}

export class LogoutResponseDto {
  readonly revokedSessionCount!: number;
}

export class LogoutAllResponseDto {
  readonly revokedSessionCount!: number;
}
