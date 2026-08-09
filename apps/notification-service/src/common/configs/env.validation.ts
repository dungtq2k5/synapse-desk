import * as Joi from 'joi';
import { LOG_LEVELS, NODE_ENV_OPTIONS } from '@synapsedesk/common';

export const envValidationSchema = Joi.object({
  // **Which build is this?** — 23-doc §3. Baked at image build time, never read
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

  NATS_URL: Joi.string().required(),

  APP_NAME: Joi.string().required(),
  // Base URL of the SPA, used to build links in outbound mail. Wrong value =
  // every reset link points somewhere useless, so it is required rather than
  // defaulted to localhost.
  APP_WEB_URL: Joi.string().uri().required(),
  SUPPORT_EMAIL: Joi.string().email().required(),

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

  NODE_ENV: Joi.string()
    .required()
    .valid(...NODE_ENV_OPTIONS),
  LOG_LEVEL: Joi.string()
    .required()
    .valid(...LOG_LEVELS),

  // Domain E's own database — added with in-app notifications (16-doc §1).
  // Email and SMS carry their recipient in the command and need no storage; a
  // feed is storage by definition.
  DATABASE_URL: Joi.string().required(),

  // The gRPC server added with the feed API (18-doc §1.1). Required rather
  // than defaulted: a service that bound to a wrong port would look healthy
  // and answer nothing, which is worse than failing to boot.
  GRPC_HOST: Joi.string().required(),
  GRPC_PORT: Joi.number().required(),

  // Applies the four partial indexes `schema.prisma` cannot express (18-doc
  // §1.2). False in tests, which seed explicitly from the fixture so there is
  // ONE seeding path rather than one that races module init.
  SEED_ON_BOOTSTRAP: Joi.boolean().required(),

  // For resolving a notification AUDIENCE from a permission code. Required:
  // an in-app notification whose recipients cannot be resolved reaches nobody,
  // and a service that boots without this would drop every one of them while
  // looking healthy.
  AUTH_SERVICE_URL: Joi.string().required(),
});
