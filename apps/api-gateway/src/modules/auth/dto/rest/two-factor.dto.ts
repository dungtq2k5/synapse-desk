import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  MAX_DEVICE_NAME_LENGTH,
  TOTP_CODE_LENGTH,
} from '../../../../common/config/dto.config';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

export class ActivateTwoFactorDto {
  @IsString()
  @Length(TOTP_CODE_LENGTH, TOTP_CODE_LENGTH)
  readonly code!: string;
}

/**
 * Exactly one of `code` / `backupCode` is used; the service rejects a request
 * carrying neither. Both are optional here because either is a valid way to
 * clear the challenge.
 */
export class AuthenticateTwoFactorDto {
  @IsOptional()
  @IsString()
  @Length(TOTP_CODE_LENGTH, TOTP_CODE_LENGTH)
  readonly code?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  // Length is deliberately NOT checked here. It would be safe to (a code's
  // length is not a secret), but `BACKUP_CODE_LENGTH` lives in auth-service and
  // a second copy in the gateway is one that silently stops matching when the
  // generator changes. auth-service compares the hash, which is the real check.
  readonly backupCode?: string;

  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional()
  readonly rememberDevice: boolean = false;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_DEVICE_NAME_LENGTH)
  readonly deviceName?: string;
}

export class DisableTwoFactorDto {
  @IsString()
  @Length(TOTP_CODE_LENGTH, TOTP_CODE_LENGTH)
  readonly code!: string;

  @IsString()
  @IsNotEmpty()
  readonly password!: string;
}

export class RegenerateBackupCodesDto {
  @IsString()
  @IsNotEmpty()
  readonly password!: string;
}
