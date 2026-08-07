import { COOKIE_SAMESITE_OPTIONS, NODE_ENV_OPTIONS } from '@synapsedesk/common';
import * as Joi from 'joi';

/**
 * A legal cookie name: RFC 6265 `token`, minus the separators.
 *
 * Worth validating because an illegal one does NOT fail at boot on its own —
 * `res.cookie()` throws when the first login tries to set it, so the symptom is
 * a 500 on the auth path with `argument name is invalid`, pointing at Express
 * rather than at the environment. A trailing `;` is the easy typo to make and
 * the worst one: `;` is the cookie SEPARATOR, so the name silently ends the
 * previous pair.
 */
const cookieName = Joi.string()
  .required()
  .pattern(/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/)
  .message('{{#label}} is not a valid cookie name');

export const envValidationSchema = Joi.object({
  PORT: Joi.number().required(),
  GLOBAL_PREFIX: Joi.string().required(),
  CORS: Joi.string().required(),

  NODE_ENV: Joi.string()
    .valid(...NODE_ENV_OPTIONS)
    .required(),

  JWT_ACCESS_NAME: cookieName,
  JWT_ACCESS_PUBLIC_KEY_PATH: Joi.string().required(),

  JWT_REFRESH_NAME: cookieName,

  JWT_2FA_NAME: cookieName,
  // Public half of the 2FA pair — separate from the access pair, so a challenge
  // token cannot verify where an access token is expected and vice versa. The
  // gateway holds no signing material of any kind: it verifies, never mints.
  JWT_2FA_PUBLIC_KEY_PATH: Joi.string().required(),

  // Short-lived token carrying a multi-tenant login between its two legs.
  TENANT_SELECTION_NAME: cookieName,

  // Opaque "remember this device" secret. Not a JWT — hence the different
  // prefix; it is never verified, only looked up.
  DEVICE_TOKEN_NAME: cookieName,

  COOKIE_ACCESS_MAX_AGE: Joi.number().required(),
  COOKIE_REFRESH_MAX_AGE: Joi.number().required(),
  COOKIE_2FA_MAX_AGE: Joi.number().required(),
  COOKIE_DEVICE_MAX_AGE: Joi.number().required(),
  COOKIE_TENANT_SELECTION_MAX_AGE: Joi.number().required(),

  COOKIE_SAMESITE: Joi.string()
    .required()
    .valid(...COOKIE_SAMESITE_OPTIONS),

  AUTH_SERVICE_URL: Joi.string().required(),
  TICKET_SERVICE_URL: Joi.string().required(),

  // ingestion-service — Domain C's document and knowledge surface.
  INGESTION_SERVICE_URL: Joi.string().required(),

  // Domain E's gRPC server, added with the feed API (18-doc §1.1). Required
  // like every other peer: a gateway that boots without it would answer 500 on
  // the notification bell rather than failing where the misconfiguration is.
  NOTIFICATION_SERVICE_URL: Joi.string().required(),

  // rag-service — the one Python peer, and the only service the gateway calls
  // that is not a NestJS app. Required like the rest: a gateway that boots
  // without it answers `/knowledge/*` with a 500 that names no cause.
  RAG_SERVICE_URL: Joi.string().required(),

  // The gateway is a hybrid app: HTTP for clients, and a NATS CONSUMER for the
  // domain events it relays to WebSocket rooms. It publishes nothing.
  NATS_URL: Joi.string().required(),

  // Rate-limit counters live in Redis rather than in-process memory: with the
  // in-memory default every replica keeps its own tally, so a 5-per-15-minutes
  // login limit silently becomes 5 x N.
  REDIS_URL: Joi.string().required(),

  // Four tiers. `short`/`medium`/`long` are the general backstop applied to
  // ordinary routes; `auth` is the strict one applied ONLY to routes marked
  // @AuthThrottle(). TTLs are milliseconds.
  THROTTLER_SHORT_TTL: Joi.number().required(),
  THROTTLER_SHORT_LIMIT: Joi.number().required(),
  THROTTLER_MEDIUM_TTL: Joi.number().required(),
  THROTTLER_MEDIUM_LIMIT: Joi.number().required(),
  THROTTLER_LONG_TTL: Joi.number().required(),
  THROTTLER_LONG_LIMIT: Joi.number().required(),
  THROTTLER_AUTH_TTL: Joi.number().required(),
  THROTTLER_AUTH_LIMIT: Joi.number().required(),

  // WebSocket handshake flood control. Separate numbers from the HTTP tiers
  // because they meter a different thing: opening a connection, not making a
  // request. Sized generously — a browser reconnects on every network blip, and
  // the cost of exhausting this is a retry rather than a lockout.
  WS_HANDSHAKE_LIMIT: Joi.number().required(),
  WS_HANDSHAKE_TTL: Joi.number().required(),
  WS_HANDSHAKE_BLOCK_DURATION: Joi.number().required(),
});
