import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENT_BYTES,
  MAX_MESSAGE_CONTENT_LENGTH,
  trimIfString,
} from '@synapsedesk/common';
import { SearchPaginationDto } from '../../../../common/dto/rest/search-pagination.dto';
import { ToBoolean } from '../../../../common/decorators/to-boolean.decorator';

export class ListMessagesQueryDto extends SearchPaginationDto {}

export class CreateMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_MESSAGE_CONTENT_LENGTH)
  @Transform(trimIfString)
  readonly content!: string;

  /**
   * Agent-only, enforced in ticket-service rather than by a route permission:
   * the route itself must stay open to end users, who post ordinary replies
   * through it.
   */
  @IsOptional()
  @IsBoolean()
  @ToBoolean()
  readonly isInternalNote?: boolean = false;

  /**
   * Ask for an AI draft after this message lands.
   *
   * Two writes, never one: the draft can fail without losing what the human
   * typed. Today it always fails — `rag-service` does not exist — and the
   * caller's own message still commits, which is exactly the behaviour that
   * has to survive Domain C shipping.
   */
  @IsOptional()
  @IsBoolean()
  @ToBoolean()
  readonly invokeAi?: boolean = false;
}

export class UpdateMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_MESSAGE_CONTENT_LENGTH)
  @Transform(trimIfString)
  readonly content!: string;
}

/**
 * Attachment metadata, validated HERE as the first of two layers.
 *
 * `storage-service` will check the same things against its own `PURPOSE_POLICY`
 * (10-storage-service.md §2.2). That is not redundancy for its own sake: this
 * layer rejects a 2 GB request before it costs a network hop, and that layer
 * holds regardless of which service asks — neither can be removed on the
 * grounds that the other exists.
 */
/** Step 5 of presign → upload → confirm: the client says the bytes landed. */
export class ConfirmAttachmentDto {
  /**
   * Echoed back from the presign response.
   *
   * Not shape-validated here on purpose: ticket-service passes it to
   * storage-service, which checks it against the PendingUpload it recorded — a
   * real authorization check rather than a syntactic one. A regex here would
   * only reject well-formed paths that were never authorized, which is exactly
   * the case the real check catches better.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  readonly objectPath!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @Transform(trimIfString)
  readonly fileName!: string;
}

export class UploadAttachmentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @Transform(trimIfString)
  readonly fileName!: string;

  /**
   * An allowlist, never a denylist. A denylist is a promise to have thought of
   * every dangerous type, which is not a promise anyone can keep.
   */
  @IsIn(ALLOWED_ATTACHMENT_MIME_TYPES)
  readonly mimeType!: string;

  /**
   * Declared by the client and therefore not trustworthy on its own — the real
   * enforcement is the signed URL's own size constraint. Checking it here still
   * earns its place: it turns "upload 2 GB, then be refused" into an immediate
   * refusal, and it documents the cap in the API contract.
   */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_ATTACHMENT_BYTES)
  readonly fileSizeBytes!: number;
}
