import {
  MAX_AVATAR_BYTES,
  MAX_UPLOAD_FILE_NAME_LENGTH,
} from '../../../../common/config/dto.config';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  AVATAR_MIME_TYPES,
  trimIfString,
  type AvatarMimeType,
  MAX_OBJECT_PATH_LENGTH,
} from '@synapsedesk/common';

// ASK This `docblock` seems to be invalid
/**
 * The avatar allowlist and cap, duplicated from storage-service's
 * `PURPOSE_POLICY` — deliberately, and this is the two-layer pattern §7.2
 * describes.
 *
 * This layer refuses a 50 MB request before it costs a network hop and
 * documents the limit in the API contract; that layer holds no matter which
 * service is asking. Neither can be removed on the grounds that the other
 * exists — and the storage suite tests that one, so a divergence shows up as a
 * gateway 200 followed by a storage 400, not as a silent widening.
 *
 * `MAX_AVATAR_BYTES` moved to `dto.config.ts`; `AVATAR_MIME_TYPES` lives in
 * `@synapsedesk/common` beside the other MIME lists. The rationale stays here,
 * where both are used together.
 */
export class PresignAvatarDto {
  /**
   * No SVG. An SVG is a document that can carry script — the one image type
   * that behaves like an executable when served.
   */
  @IsIn(AVATAR_MIME_TYPES)
  readonly contentType!: AvatarMimeType;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_AVATAR_BYTES)
  readonly sizeBytes!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(MAX_UPLOAD_FILE_NAME_LENGTH)
  @Transform(trimIfString)
  readonly fileName!: string;
}

export class ConfirmAvatarDto {
  /**
   * The path the presign step returned, echoed back.
   *
   * Not validated as a URL or a shape here, on purpose: storage-service checks
   * it against the PendingUpload it recorded, which is a real authorization
   * check rather than a syntactic one. A regex here would only reject
   * well-formed paths that were never authorized — the exact case the real
   * check catches better.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_OBJECT_PATH_LENGTH)
  readonly objectPath!: string;
}

export class PresignAvatarResponseDto {
  uploadUrl!: string;
  objectPath!: string;
  expiresAt!: Date;
}
