import * as Joi from 'joi';
import { NODE_ENV_OPTIONS } from '@synapsedesk/common';

export const envValidationSchema = Joi.object({
  // **Which build is this?** Baked at image build time, never read
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

  // NO DATABASE_URL. `storage-service` has no Postgres at all — its only state
  // is a few-minutes-lived PendingUpload, which is a cache entry, and giving it
  // a database tier for that would be provisioning a whole service for
  // something Redis's TTL already cleans up for free (§1.2).

  // A SEPARATE service account from auth-service's. That one is scoped to
  // Firebase Auth and has no Storage grant; this one is scoped to Storage and
  // has no Auth grant. Neither can do the other's job (§1.4).
  FIREBASE_STORAGE_SERVICE_ACCOUNT_PATH: Joi.string().required(),
  FIREBASE_STORAGE_BUCKET: Joi.string().required(),

  // Where PendingUpload records live, with the TTL as their cleanup mechanism.
  REDIS_URL: Joi.string().required(),
  // A distinct db index, so a test run cannot collide with dev data in the same
  // Redis instance.
  REDIS_DB: Joi.number().default(0),

  // The gRPC server the owning services call.
  GRPC_HOST: Joi.string().required(),
  GRPC_PORT: Joi.number().required(),

  // Consumes `storage.object.superseded`. Publish-only services can skip this;
  // this one cannot.
  NATS_URL: Joi.string().required(),

  // How long a signed upload URL — and its PendingUpload — lives.
  UPLOAD_URL_TTL_SECONDS: Joi.number().default(600),
  // How long a signed READ url lives. Short: revoking access to a ticket takes
  // effect on the next issuance, so a long TTL is how long a revoked user keeps
  // reading.
  READ_URL_TTL_SECONDS: Joi.number().default(900),
});
