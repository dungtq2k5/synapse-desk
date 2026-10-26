/**
 * Browser errors the web reports to `POST /api/v1/client-errors`, which only
 * logs them (and counts them by kind).
 *
 * - `error`: an uncaught exception (`window` `error`);
 * - `rejection`: an unhandled promise rejection;
 * - `boundary`: what an error boundary (`error.tsx`, `global-error.tsx`) caught.
 */
export const CLIENT_ERROR_KINDS = ['error', 'rejection', 'boundary'] as const;
export type ClientErrorKind = (typeof CLIENT_ERROR_KINDS)[number];

/** A report's largest body, in bytes. A larger one is refused with 413. */
export const CLIENT_ERROR_MAX_BYTES = 8 * 1024;

/** The longest `message` a report may carry. */
export const CLIENT_ERROR_MESSAGE_MAX = 1000;

/** How much of `stack` the log line keeps. */
export const CLIENT_ERROR_STACK_KEPT = 2000;

/** The longest `path` a report may carry. */
export const CLIENT_ERROR_PATH_MAX = 2000;

/** The longest `buildId` a report may carry. */
export const CLIENT_ERROR_BUILD_ID_MAX = 64;

/** How much of the `User-Agent` header the log line keeps. */
export const CLIENT_ERROR_USER_AGENT_KEPT = 300;
