/**
 * @file Process-level options and the SPA's own routes.
 *
 * The unions here are what `env.validation` checks a deployment against, so a
 * bad `NODE_ENV` fails at boot rather than at the first branch that reads it.
 */

export const NODE_ENV_OPTIONS = ['development', 'production', 'test'] as const;
export type NodeEnv = (typeof NODE_ENV_OPTIONS)[number];

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'fatal'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const COOKIE_SAMESITE_OPTIONS = ['strict', 'lax', 'none'] as const;
export type CookieSameSite = (typeof COOKIE_SAMESITE_OPTIONS)[number];

/**
 * SPA routes that BACKEND-generated links point at.
 *
 * These are frontend paths, not API endpoints — a password-reset email has to
 * open a page where the user can type a new password, not POST to an API. They
 * live here so the email builder and the SPA router are driven by one list
 * rather than two string literals that silently drift apart.
 */
export const WEB_ROUTES = {
  resetPassword: '/reset-password',
  verifyEmail: '/verify-email',
  acceptInvitation: '/invitations/accept',
} as const;
