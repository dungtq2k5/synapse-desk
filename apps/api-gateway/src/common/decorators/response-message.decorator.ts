import { SetMetadata } from '@nestjs/common';

export const RESPONSE_MESSAGE_KEY = 'response_message';

/**
 * Static success message for a route, read by `TransformInterceptor`.
 *
 * For a message only known at runtime, set `response.locals.message` from the
 * handler instead (inject `@Res({ passthrough: true })`) — the dynamic value
 * wins over this one.
 */
export const ResponseMessage = (message: string) =>
  SetMetadata(RESPONSE_MESSAGE_KEY, message);
