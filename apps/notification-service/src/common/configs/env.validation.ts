import * as Joi from 'joi';
import { LOG_LEVELS, NODE_ENV_OPTIONS } from '@synapsedesk/common';

/**
 * Keys in the shared section order (RUNTIME, BUILD, DATA, MESSAGING, PEERS,
 * AUTH & SECRETS, THIRD PARTY, POLICY, DEVELOPMENT), the same order
 * `.env.example` uses — one of them is the schema and the other is the
 * documentation, and a reader comparing them should not have to search.
 */
export const envValidationSchema = Joi.object({
  // ------------------------------------------------------------- 1 RUNTIME

  NODE_ENV: Joi.string()
    .required()
    .valid(...NODE_ENV_OPTIONS),
  LOG_LEVEL: Joi.string()
    .required()
    .valid(...LOG_LEVELS),

  // The gRPC server added with the feed API. Required rather
  // than defaulted: a service that bound to a wrong port would look healthy
  // and answer nothing, which is worse than failing to boot.
  GRPC_HOST: Joi.string().required(),
  GRPC_PORT: Joi.number().required(),

  // --------------------------------------------------------------- 2 BUILD
  // **Which build is this?**. Baked at image build time, never read
  // from git at runtime: a container has no `.git`, so a runtime lookup returns
  // nothing and the natural fallback is `"unknown"` — the answer you get at
  // exactly the moment you need the real one.
  //
  // `required()` rather than a default, and that IS the enforcement: an image
  // that cannot identify itself fails to BOOT rather than lying about what it
  // is. The Dockerfile's `test -n "$GIT_SHA"` guard is the same rule one stage
  // earlier.

  APP_VERSION: Joi.string().required(),
  BUILD_SHA: Joi.string().required(),
  BUILD_TIME: Joi.string().isoDate().required(),

  // ---------------------------------------------------------------- 3 DATA

  // Domain E's own database — added with in-app notifications.
  // Email and SMS carry their recipient in the command and need no storage; a
  // feed is storage by definition.
  DATABASE_URL: Joi.string().required(),

  // BullMQ — the webhook delivery queue and the scheduler. This service had no
  // Redis at all before outbound webhooks.
  REDIS_URL: Joi.string().required(),

  // ----------------------------------------------------------- 4 MESSAGING

  NATS_URL: Joi.string().required(),
  // The HTTP monitoring root, read once at boot to prove JetStream's store
  // survives a container recreate. Required rather than optional: this
  // service declares a durable stream, and one it cannot verify is worse
  // than none — see ADR 0041.
  NATS_MONITOR_URL: Joi.string().uri().required(),

  // --------------------------------------------------------------- 5 PEERS

  // For resolving a notification AUDIENCE from a permission code. Required:
  // an in-app notification whose recipients cannot be resolved reaches nobody,
  // and a service that boots without this would drop every one of them while
  // looking healthy.
  AUTH_SERVICE_URL: Joi.string().required(),

  // ------------------------------------------------------- 6 AUTH & SECRETS

  // Building the `Reply-To` that makes an emailed notification answerable —
  // The secret must MATCH the gateway's: it verifies what this
  // signs, and a mismatch makes every reply open a duplicate ticket rather
  // than failing visibly.
  INBOUND_EMAIL_SECRET: Joi.string().required(),
  INBOUND_EMAIL_DOMAIN: Joi.string().required(),

  // --------------------------------------------------------- 7 THIRD PARTY

  // Nodemailer (Gmail SMTP by default)
  EMAIL_HOST: Joi.string().required(),
  EMAIL_PORT: Joi.number().required(),
  // true for 465 (implicit TLS), false for 587 (STARTTLS).
  EMAIL_SECURE: Joi.boolean().required(),
  EMAIL_USER: Joi.string().required(),
  EMAIL_PASS: Joi.string().required(),
  EMAIL_SENDER: Joi.string().required(),

  // Twilio. Optional as a group: SMS is only needed once phone verification is
  // switched on, and requiring credentials would block every other notification
  // from working in development.
  TWILIO_SID: Joi.string().optional().allow(''),
  TWILIO_AUTH_TOKEN: Joi.string().optional().allow(''),
  TWILIO_AUTH_PHONE: Joi.string().optional().allow(''),

  // FCM, optional for the same reason and with the same posture: push is one
  // channel of four, and a notification-service that refuses to start without a
  // credential takes the in-app feed and email down with it. Unset, the service
  // logs once at boot and records a FAILED delivery row per push attempt — off
  // has to be VISIBLY off in the table people read to answer "why didn't I get
  // notified", which is the half `SmsService` states and a silent no-op would
  // lose.
  //
  // `storage-service` REQUIRES its own Firebase credential, and that asymmetry
  // is deliberate: every presign needs it, so booting without one only defers
  // the failure to a request.
  FIREBASE_MESSAGING_SERVICE_ACCOUNT_PATH: Joi.string().optional().allow(''),

  // -------------------------------------------------------------- 8 POLICY

  APP_NAME: Joi.string().required(),
  // Base URL of the SPA, used to build links in outbound mail. Wrong value =
  // every reset link points somewhere useless, so it is required rather than
  // defaulted to localhost.
  APP_WEB_URL: Joi.string().uri().required(),
  SUPPORT_EMAIL: Joi.string().email().required(),

  // --------------------------------------------------------- 9 DEVELOPMENT

  // The SSRF escape hatch, for a developer's localhost receiver. Honoured ONLY
  // when NODE_ENV is development — see `privateTargetsAllowed` — so a copied
  // .env cannot carry it into production.
  //
  // **Refused outright outside development too, in ADDITION to that guard and
  // never instead of it.** `webhook-target.guard.ts` is the control, because
  // doc 69's lesson is that a string check is a courtesy and the real refusal
  // belongs at the enforcement point. What this adds is loudness: a production
  // `.env` carrying `WEBHOOK_ALLOW_PRIVATE_TARGETS=true` boots fine today and
  // the value is silently ignored, which teaches an operator that the setting
  // works. Failing here says otherwise, once, at the only moment anybody is
  // looking.
  //
  // `.optional()` first, so an ABSENT variable stays fine everywhere and the
  // `otherwise` branch governs only a value that is present. Both properties
  // are pinned in `webhook-private-targets.spec.ts` — including the
  // unset-`NODE_ENV` row, because a rule keyed on an environment variable is
  // only as good as its behaviour when that variable is missing.
  //
  // **`invalid('true')`, not `valid('false')`, and the difference is not
  // stylistic.** Joi CONCATENATES a `when` branch onto the base rather than
  // replacing it, so `valid('false')` unions with the base's
  // `valid('true','false')` and permits exactly what it looks like it forbids.
  // Measured: with that spelling every environment accepted `true`, and the
  // behavioural rows are what caught it — the file read correctly either way.
  WEBHOOK_ALLOW_PRIVATE_TARGETS: Joi.string()
    .valid('true', 'false')
    .optional()
    .when('NODE_ENV', { is: 'development', otherwise: Joi.invalid('true') }),
});
