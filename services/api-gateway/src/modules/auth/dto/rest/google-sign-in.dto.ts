import { ApiProperty } from '@nestjs/swagger';
import { MAX_DEVICE_NAME_LENGTH } from '../../../../common/config/dto.config';
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
  // `@IsNotEmpty` has no OpenAPI spelling of its own, so without this the
  // document says `{"type": "string"}` and a generated client accepts `""`
  // — a 400 here and a pass elsewhere. `minLength: 1` is the document's way
  // to say it, and it generates `@Size(min = 1)`, which (unlike `@NotBlank`)
  // accepts `"   "` exactly as `@IsNotEmpty` does.
  @ApiProperty({ minLength: 1 })
  readonly idToken!: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_DEVICE_NAME_LENGTH)
  readonly deviceName?: string;
}
