import { MAX_DEVICE_NAME_LENGTH } from 'apps/api-gateway/src/common/config/app.config';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class GoogleSignInDto {
  /**
   * The Firebase ID token the browser obtained from the Google flow.
   *
   * Safe to accept from the body precisely because it is not trusted:
   * auth-service verifies its signature against Google's public keys, so a
   * forged value fails there rather than being believed here.
   */
  @IsString()
  @IsNotEmpty()
  readonly idToken!: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_DEVICE_NAME_LENGTH)
  readonly deviceName?: string;
}
