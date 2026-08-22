import * as Joi from 'joi';
import { NODE_ENV_OPTIONS } from '@synapsedesk/common';

export const envValidationSchema = Joi.object({
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

  NODE_ENV: Joi.string()
    .valid(...NODE_ENV_OPTIONS)
    .required(),

  DATABASE_URL: Joi.string().required(),

  // Required for BOTH directions. ticket-service publishes ticket.* domain
  // events AND subscribes to audit.record — it is the first service in this
  // repo to be a NATS consumer, not just a publisher.
  NATS_URL: Joi.string().required(),
  // The HTTP monitoring root, read once at boot to prove JetStream's store
  // survives a container recreate. Required rather than optional: this
  // service declares a durable stream, and one it cannot verify is worse
  // than none — see ADR 0041.
  NATS_MONITOR_URL: Joi.string().uri().required(),

  // The gRPC server this service exposes to the gateway.
  GRPC_HOST: Joi.string().required(),
  GRPC_PORT: Joi.number().required(),

  // The gRPC CLIENT pointed back at auth-service, for the write-time validation
  // of cross-database references (author_id, assignee_id, department_id). There
  // is no foreign key that could do this, so a service that cannot reach
  // auth-service cannot safely create a ticket — hence required, not optional.
  AUTH_SERVICE_URL: Joi.string().required(),

  // The gRPC client pointed at storage-service, for message attachments.
  // Required rather than optional: an attachment endpoint that 500s because a
  // URL was never configured is worse than a service that refuses to boot.
  STORAGE_SERVICE_URL: Joi.string().required(),

  // Applies the partial unique index and the CHECK constraint on boot. False in
  // the test environment, where the fixture calls the seeder explicitly.
  SEED_ON_BOOTSTRAP: Joi.boolean().required(),

  // How long a sender may edit their own message. Named and configured rather
  // than a hardcoded number, the same treatment OTP_EXPIRY_MINUTES gets.
  MESSAGE_EDIT_WINDOW_MINUTES: Joi.number().required(),

  // Required now that Domain C has shipped. It was optional for one reason —
  // "this service cannot boot until rag-service exists" — and that reason has
  // expired: the co-pilot RPCs are implemented on both sides.
  //
  // Required rather than optional for the same reason `STORAGE_SERVICE_URL` is
  // in auth-service: an AI endpoint that answers 503 because a URL was never
  // configured is indistinguishable, to whoever is on call, from rag-service
  // being down — and it stays that way until a customer complains. A service
  // that refuses to boot says which of the two it is, immediately.
  //
  // Optional in TEST only, where the suite drives `isAvailable` directly to
  // exercise both branches without standing up a Python service.
  RAG_SERVICE_URL: Joi.string().when('NODE_ENV', {
    is: 'test',
    then: Joi.optional(),
    otherwise: Joi.required(),
  }),
  // The export queue's Redis. ticket-service's FIRST queue: it had
  // no Redis at all before analytics, which is why the whole `BullModule`
  // registration lives in `AnalyticsModule` rather than in `AppModule`.
  REDIS_URL: Joi.string().required(),
  REDIS_DB: Joi.number().optional(),
});
