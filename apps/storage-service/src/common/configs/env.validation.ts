import * as Joi from 'joi';
import { NODE_ENV_OPTIONS } from '@synapsedesk/common';

/**
 * Keys in the shared section order (RUNTIME, BUILD, DATA, MESSAGING, THIRD
 * PARTY, POLICY, DEVELOPMENT), the same order `.env.example` uses — one of
 * them is the schema and the other is the documentation, and a reader
 * comparing them should not have to search.
 */
export const envValidationSchema = Joi.object({
  // ------------------------------------------------------------- 1 RUNTIME

  NODE_ENV: Joi.string()
    .valid(...NODE_ENV_OPTIONS)
    .required(),

  // The gRPC server the owning services call.
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

  // NO DATABASE_URL. `storage-service` has no Postgres at all — its only state
  // is a few-minutes-lived PendingUpload, which is a cache entry, and giving it
  // a database tier for that would be provisioning a whole service for
  // something Redis's TTL already cleans up for free.

  // Where PendingUpload records live, with the TTL as their cleanup mechanism.
  REDIS_URL: Joi.string().required(),
  // A distinct db index, so a test run cannot collide with dev data in the same
  // Redis instance.
  REDIS_DB: Joi.number().default(0),

  // ----------------------------------------------------------- 4 MESSAGING

  // Consumes `storage.object.superseded`. Publish-only services can skip this;
  // this one cannot.
  NATS_URL: Joi.string().required(),

  // --------------------------------------------------------- 7 THIRD PARTY

  // A SEPARATE service account from auth-service's. That one is scoped to
  // Firebase Auth and has no Storage grant; this one is scoped to Storage and
  // has no Auth grant. Neither can do the other's job.
  FIREBASE_STORAGE_SERVICE_ACCOUNT_PATH: Joi.string().required(),
  FIREBASE_STORAGE_BUCKET: Joi.string().required(),

  // -------------------------------------------------------------- 8 POLICY

  // How long a signed upload URL — and its PendingUpload — lives.
  UPLOAD_URL_TTL_SECONDS: Joi.number().default(600),
  // How long a signed READ url lives. Short: revoking access to a ticket takes
  // effect on the next issuance, so a long TTL is how long a revoked user keeps
  // reading.
  READ_URL_TTL_SECONDS: Joi.number().default(900),

  // --------------------------------------------------------- 9 DEVELOPMENT

  // The Storage emulator, dev and test only — production leaves it unset and
  // talks to the real bucket. Read by firebase-admin ITSELF, not by any code
  // in this service, which is why it went unvalidated for so long.
  //
  // ONE variable, deliberately: `.env` used to also carry the lower-layer
  // `STORAGE_EMULATOR_HOST` (@google-cloud/storage's own knob, URL-shaped).
  // Measured against the emulator suite: either variable alone passes 70/70
  // and neither fails everything — firebase-admin 14 translates this one down
  // to the GCS layer itself, so the second was the both-layers workaround
  // older SDKs needed, kept alive by copy-paste. `host:port`, no scheme.
  FIREBASE_STORAGE_EMULATOR_HOST: Joi.string().optional(),

  // The SSRF escape hatch for fetching an inbound attachment from a localhost
  // source. Honoured ONLY when NODE_ENV is development — `privateTargetsAllowed`
  // in `libs/common`'s `guarded-target.ts` checks that itself, and that is the
  // control; this rule adds loudness, refusing to boot with `true` anywhere
  // else so a copied `.env` cannot suggest the setting works in production.
  //
  // `.optional()` first, so an ABSENT variable is fine everywhere. And
  // `invalid('true')`, not `valid('false')`: Joi CONCATENATES a `when` branch
  // onto the base, so `valid('false')` unions with `valid('true','false')` and
  // permits exactly what it looks like it forbids. Pinned in
  // `ingest-private-sources.spec.ts`.
  INGEST_ALLOW_PRIVATE_SOURCES: Joi.string()
    .valid('true', 'false')
    .optional()
    .when('NODE_ENV', { is: 'development', otherwise: Joi.invalid('true') }),
});
