import * as Joi from 'joi';
import { NODE_ENV_OPTIONS } from '@synapsedesk/common';

/**
 * Keys in the shared section order (RUNTIME, BUILD, DATA, MESSAGING, PEERS,
 * THIRD PARTY, POLICY, DEVELOPMENT), the same order `.env.example` uses — one
 * of them is the schema and the other is the documentation, and a reader
 * comparing them should not have to search.
 */
export const envValidationSchema = Joi.object({
  // ------------------------------------------------------------- 1 RUNTIME

  NODE_ENV: Joi.string()
    .valid(...NODE_ENV_OPTIONS)
    .required(),

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

  DATABASE_URL: Joi.string().required(),

  // BullMQ's queue, and from build-order step 2 the AI quota counter.
  REDIS_URL: Joi.string().required(),
  // A distinct index in the test environment, so a suite's flush cannot take a
  // developer's dev data with it.
  REDIS_DB: Joi.number().default(0),

  // Required: the vector store is not optional infrastructure for a service
  // whose whole purpose is producing vectors, and a worker that boots without
  // it fails on the first document rather than at startup.
  QDRANT_URL: Joi.string().required(),

  // ----------------------------------------------------------- 4 MESSAGING

  NATS_URL: Joi.string().required(),
  NATS_MONITOR_URL: Joi.string().uri().required(),

  // --------------------------------------------------------------- 5 PEERS

  // Required, not optional: `created_by_id` and `department_id` carry no
  // foreign key, so a service that cannot reach auth-service cannot safely
  // create a document. The storage quota gate reads it too.
  AUTH_SERVICE_URL: Joi.string().required(),

  // Required for the same reason: without it `POST /documents/presign` has no
  // way to sign anything, and an endpoint that 500s because a URL was never
  // configured is worse than a service that refuses to boot.
  STORAGE_SERVICE_URL: Joi.string().required(),

  // --------------------------------------------------------- 7 THIRD PARTY

  // Required in every environment EXCEPT test, where the pipeline runs against
  // a substitute embedding client — deliberately, so the ingestion tests
  // need no API key, no network and no per-run spend.
  GEMINI_API_KEY: Joi.string().when('NODE_ENV', {
    is: 'test',
    then: Joi.optional(),
    otherwise: Joi.required(),
  }),

  // -------------------------------------------------------------- 8 POLICY

  // How long a download URL is ADVERTISED as valid, in seconds.
  //
  // storage-service mints the URL and owns its real lifetime
  // (`READ_URL_TTL_SECONDS`, 900); this service only reports an expiry to the
  // client. The two are separate settings in separate services and nothing
  // enforces the relationship, so it is stated here:
  //
  //   DOWNLOAD_URL_TTL_SECONDS  <  storage-service's READ_URL_TTL_SECONDS
  //
  // Strictly shorter, deliberately. A client refreshing on expiry then does so
  // just BEFORE the URL dies rather than just after — the failure mode of
  // getting this backwards is a download that 403s for a URL the client was
  // told was still good, which reads like a permissions bug rather than a
  // clock-skew one. The default leaves a 60-second margin.
  DOWNLOAD_URL_TTL_SECONDS: Joi.number().default(840),
});
