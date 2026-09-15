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
const validCookieName = Joi.string()
  .required()
  .pattern(/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/)
  .message('{{#label}} is not a valid cookie name');

/**
 * Keys in the shared section order (RUNTIME, BUILD, DATA, MESSAGING, PEERS,
 * AUTH & SECRETS, POLICY), the same order `.env.example` uses — one of them
 * is the schema and the other is the documentation, and a reader comparing
 * them should not have to search.
 */
export const envValidationSchema = Joi.object({
  // ------------------------------------------------------------- 1 RUNTIME

  NODE_ENV: Joi.string()
    .valid(...NODE_ENV_OPTIONS)
    .required(),

  PORT: Joi.number().required(),
  // The prefix ALONE. URI versioning adds `/v1`, so a value that carries the
  // version boots cleanly and serves every route at `/api/v1/v1/…` while the
  // version-neutral probes keep every pod ready — refused here, loudly.
  GLOBAL_PREFIX: Joi.string()
    .required()
    .pattern(/^\/?api$/)
    .message(
      '{{#label}} must be "api" — the version is added by URI versioning, not carried by the prefix',
    ),
  CORS: Joi.string().required(),

  // `/docs` and `/docs-json`. Defaults to FALSE, so an environment that never
  // considered the question is closed rather than open. **Config, not an
  // inline `NODE_ENV !== 'production'`**: that check is the one that gets
  // inverted during a refactor and nobody notices, because the failure
  // direction is MORE exposure and more exposure looks like everything
  // working.
  SWAGGER_ENABLED: Joi.boolean().default(false),

  // `/metrics`, on its OWN listener. A distinct port is what makes
  // "not reachable from the internet" structural rather than a rule Nginx has
  // to keep enforcing correctly forever.
  METRICS_PORT: Joi.number().required(),
  // Loopback by DEFAULT. A Kubernetes pod needs `0.0.0.0` for the scraper to
  // reach it, so this is a real knob — but the default must be the closed one,
  // so a deployment that never thought about it is safe rather than exposed.
  METRICS_HOST: Joi.string().default('127.0.0.1'),

  // --------------------------------------------------------------- 2 BUILD
  // **Which build is this?**. Baked at image build time, never read
  // from git at runtime: a container has no `.git`, so a runtime lookup returns
  // nothing and the natural fallback is `"unknown"` — the answer you get at
  // exactly the moment you need the real one.
  //
  // `required()` rather than a default, and that is the enforcement: an image
  // that cannot identify itself fails to BOOT, loudly and immediately, instead
  // of starting happily and lying to the person trying to end an outage. The
  // Dockerfile's `test -n "$GIT_SHA"` guard is the same rule one stage earlier.

  APP_VERSION: Joi.string().required(),
  BUILD_SHA: Joi.string().required(),
  BUILD_TIME: Joi.string().isoDate().required(),

  // ---------------------------------------------------------------- 3 DATA

  // Rate-limit counters live in Redis rather than in-process memory: with the
  // in-memory default every replica keeps its own tally, so a 5-per-15-minutes
  // login limit silently becomes 5 x N.
  REDIS_URL: Joi.string().required(),

  // ----------------------------------------------------------- 4 MESSAGING

  // The gateway is a hybrid app: HTTP for clients, and a NATS CONSUMER for the
  // domain events it relays to WebSocket rooms. It publishes nothing.
  NATS_URL: Joi.string().required(),

  // --------------------------------------------------------------- 5 PEERS

  AUTH_SERVICE_URL: Joi.string().required(),
  TICKET_SERVICE_URL: Joi.string().required(),

  // ingestion-service — document and knowledge surface.
  INGESTION_SERVICE_URL: Joi.string().required(),

  // Notification gRPC server, added with the feed API. Required
  // like every other peer: a gateway that boots without it would answer 500 on
  // the notification bell rather than failing where the misconfiguration is.
  NOTIFICATION_SERVICE_URL: Joi.string().required(),

  // rag-service — the one Python peer, and the only service the gateway calls
  // that is not a NestJS app. Required like the rest: a gateway that boots
  // without it answers `/knowledge/*` with a 500 that names no cause.
  RAG_SERVICE_URL: Joi.string().required(),

  // ------------------------------------------------------- 6 AUTH & SECRETS

  JWT_ACCESS_NAME: validCookieName,
  JWT_ACCESS_PUBLIC_KEY_PATH: Joi.string().required(),

  JWT_REFRESH_NAME: validCookieName,

  JWT_2FA_NAME: validCookieName,
  // Public half of the 2FA pair — separate from the access pair, so a challenge
  // token cannot verify where an access token is expected and vice versa. The
  // gateway holds no signing material of any kind: it verifies, never mints.
  JWT_2FA_PUBLIC_KEY_PATH: Joi.string().required(),

  // Short-lived token carrying a multi-tenant login between its two legs.
  TENANT_SELECTION_NAME: validCookieName,

  // Opaque "remember this device" secret. Not a JWT — hence the different
  // prefix; it is never verified, only looked up.
  DEVICE_TOKEN_NAME: validCookieName,

  COOKIE_ACCESS_MAX_AGE: Joi.number().required(),
  COOKIE_REFRESH_MAX_AGE: Joi.number().required(),
  COOKIE_2FA_MAX_AGE: Joi.number().required(),
  COOKIE_DEVICE_MAX_AGE: Joi.number().required(),
  COOKIE_TENANT_SELECTION_MAX_AGE: Joi.number().required(),

  COOKIE_SAMESITE: Joi.string()
    .required()
    .valid(...COOKIE_SAMESITE_OPTIONS),

  // Inbound email — the gateway is the email adapter: it verifies Resend's
  // webhook signature, fetches the mail, parses the address, and runs the loop
  // guards.

  /**
   * Shared with notification-service — it mints the per-ticket reply token
   * into `Reply-To`, and the gateway parses that token back out.
   */
  INBOUND_EMAIL_SECRET: Joi.string().required(),

  /**
   * The Standard Webhooks signing secret of the Resend `email.received`
   * webhook. Readable back later with `webhooks.get`.
   */
  RESEND_WEBHOOK_SECRET: Joi.string()
    .pattern(/^whsec_/)
    .required()
    .messages({
      'string.pattern.base': 'RESEND_WEBHOOK_SECRET must start with whsec_',
    }),

  /**
   * The gateway's OWN Resend key, for `emails.receiving.get`. A different key
   * and name from notification-service's `RESEND_API_KEY`: a leaked gateway key
   * must not be the sending key, and a rotated sending key must not stop
   * inbound mail.
   */
  RESEND_GATEWAY_API_KEY: Joi.string().pattern(/^re_/).required().messages({
    'string.pattern.base': 'RESEND_GATEWAY_API_KEY must start with re_',
  }),

  /** The mail domain the catch-all route serves, for building `Reply-To`. */
  INBOUND_EMAIL_DOMAIN: Joi.string().required(),

  /**
   * **The self-loop guard's whole basis**
   *
   * Our own sending address. Mail from it is ignored unconditionally, which is
   * what stops a notification bouncing off an auto-responder forever.
   *
   * `required()` rather than optional, and that is the point: a guard reading
   * an undefined variable always passes, and it fails OPEN into precisely the
   * unbounded loop it exists to stop. Better to refuse to boot.
   */
  EMAIL_SENDER: Joi.string().required(),

  // -------------------------------------------------------------- 8 POLICY

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
