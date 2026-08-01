import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { UserResponseDto } from '../../../users/dto/rest/user-response.dto';
import { Type } from 'class-transformer';

/**
 * 2FA challenge. The short-lived 2FA token also travels as a cookie, so this
 * body exists only to tell the SPA which screen to render next.
 *
 * The union `LoginResponseDto | TwoFactorRequiredResponseDto` lives here, at
 * the REST edge, because TypeScript can express it. gRPC cannot — a method
 * returns exactly one message type — so the wire carries a single
 * `LoginResponse` discriminated by `requires_two_factor`.
 */
export class TwoFactorRequiredResponseDto {
  readonly requiresTwoFactor!: true;
}

export class ActivateTwoFactorDto {
  @IsString()
  @Length(6, 6)
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
  @Length(6, 6)
  readonly code?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  readonly backupCode?: string;

  @IsOptional()
  @IsBoolean()
  readonly rememberDevice?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  readonly deviceName?: string;
}

export class DisableTwoFactorDto {
  @IsString()
  @Length(6, 6)
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

export class GenerateTwoFactorResponseDto {
  readonly otpauthUri!: string;
  readonly qrCodeDataUrl!: string;
}

export class BackupCodesResponseDto {
  /** Shown once. Only hashes are stored. */
  readonly backupCodes!: string[];
}

export class BackupCodesStatusResponseDto {
  readonly remaining!: number;
  readonly used!: number;
  readonly expiresAt!: Date | null;
}

/** Same shape as a successful login, plus an optional low-codes warning. */
export class TwoFactorAuthenticatedResponseDto {
  @Type(() => UserResponseDto)
  @ValidateNested()
  readonly user!: UserResponseDto;

  readonly warning!: string | null;
}
