/** @file Normalizing anything throwable into one readable message. */

import { HttpException } from '@nestjs/common';

/**
 * Reads a `message` field that may be a string, an array of strings, or neither.
 *
 * The array case is class-validator's: a failed `ValidationPipe` puts one entry
 * per broken rule on the response, and joining them is what makes a 400 read as
 * a sentence rather than `[object Object]`.
 *
 * @param message - the `message` property, whatever it turned out to be
 * @param fallback - used when it is neither a string nor an array
 */
function readMessage(message: unknown, fallback: string): string {
  if (Array.isArray(message)) return message.join(', ');
  if (typeof message === 'string') return message;

  return fallback;
}

/**
 * Normalizes anything throwable into one message ending in a single `!`.
 *
 * Prefer this over `err.message`, which is `undefined` for a non-`Error` throw.
 *
 * @example
 * catch (error) {
 *   this.logger.error(formatErrorMsg(error));
 * }
 *
 * @param err - anything a `catch` can receive
 * @param exceptionMsg - used when `err` carries no message at all
 */
export function formatErrorMsg(
  err: unknown,
  exceptionMsg: string = 'An unknown error occurred',
): string {
  // No `= ''` initializer: the chain below ends in a bare `else`, so every path
  // assigns. Seeding it with a value only hides a missing branch if one is ever
  // added — TypeScript's definite-assignment analysis catches that, an empty
  // string does not.
  let formattedMsg: string;

  if (err instanceof HttpException) {
    const response = err.getResponse() as string | { message?: unknown };

    formattedMsg =
      typeof response === 'string'
        ? response
        : readMessage(response?.message, err.message);
  } else if (err instanceof Error) {
    formattedMsg = err.message;
  } else if (err && typeof err === 'object' && 'message' in err) {
    // `String(message)` rather than the caller's fallback: the object DID carry
    // a message, so rendering it beats discarding it.
    formattedMsg = readMessage(err.message, String(err.message));
  } else if (typeof err === 'string') {
    formattedMsg = err;
  } else {
    formattedMsg = exceptionMsg;
  }

  // Trailing `.`/`!`/`?` trimmed by index rather than by regex: this runs on
  // every logged error, and the loop allocates nothing.
  let end = formattedMsg.length;
  while (
    end > 0 &&
    (formattedMsg[end - 1] === '.' ||
      formattedMsg[end - 1] === '!' ||
      formattedMsg[end - 1] === '?')
  ) {
    end--;
  }

  return formattedMsg.slice(0, end) + '!';
}
