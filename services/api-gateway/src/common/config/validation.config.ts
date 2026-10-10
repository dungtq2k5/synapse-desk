import type { ValidationPipeOptions } from '@nestjs/common';

/**
 * The global `ValidationPipe`'s options, and the same options for an object
 * validated by hand.
 *
 * **One constant, because there are two ways in.** Every `@Body()` is checked by
 * the pipe `main.ts` installs. An object a handler BUILDS — the inbound mail the
 * Resend webhook assembles from two API responses — never meets that pipe, so it
 * is passed to `validateOrReject` with these options instead. Two copies of the
 * options would drift, and the drift would be a constraint that silently stops
 * applying on one path.
 *
 * `transform` is the pipe's own switch and means nothing to `validateOrReject`;
 * `whitelist` and `forbidNonWhitelisted` apply to both.
 */
export const VALIDATION_PIPE_OPTIONS = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
} as const satisfies ValidationPipeOptions;
