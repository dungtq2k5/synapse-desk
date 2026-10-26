import {
  CLIENT_ERROR_BUILD_ID_MAX,
  CLIENT_ERROR_KINDS,
  CLIENT_ERROR_MESSAGE_MAX,
  CLIENT_ERROR_PATH_MAX,
  type ClientErrorKind,
} from '@synapsedesk/contracts';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/** `POST /client-errors`: one browser error. The log keeps nothing else. */
export class ReportClientErrorDto {
  @IsIn(CLIENT_ERROR_KINDS)
  readonly kind!: ClientErrorKind;

  @IsString()
  @MaxLength(CLIENT_ERROR_MESSAGE_MAX)
  readonly message!: string;

  /** Kept truncated. */
  @IsOptional()
  @IsString()
  readonly stack?: string;

  /** The page's path; its query and fragment are dropped before logging. */
  @IsString()
  @MaxLength(CLIENT_ERROR_PATH_MAX)
  readonly path!: string;

  /** The web build that reported it (`GIT_SHA`). */
  @IsOptional()
  @IsString()
  @MaxLength(CLIENT_ERROR_BUILD_ID_MAX)
  readonly buildId?: string;
}
