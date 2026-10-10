import { MAX_UPLOAD_FILE_NAME_LENGTH } from '../../../../common/config/dto.config';
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
  MAX_AVATAR_BYTES,
  MAX_OBJECT_PATH_LENGTH,
  trimIfString,
  type AvatarMimeType,
} from '@synapsedesk/common';

// The allowlist and cap are duplicated from storage-service's
// `PURPOSE_POLICY`, deliberately: this layer refuses a 50 MB request before it
// costs a network hop, that layer holds whichever service is asking. Neither
// can be dropped because the other exists -- widen BOTH or neither.
/** Asks for a presigned URL to upload a new avatar. */
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
