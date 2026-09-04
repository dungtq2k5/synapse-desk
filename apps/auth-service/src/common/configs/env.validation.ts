import * as Joi from 'joi';
import {
  LOG_LEVELS,
  MIN_PASSWORD_LENGTH,
  NODE_ENV_OPTIONS,
} from '@synapsedesk/common';

/**
 * Passwords that exist in this repository, and therefore in everyone's clone.
 *
 * Exported so `super-admin-password.spec.ts` can assert the list against the
 * files that publish them rather than restating the strings — the same
 * counting-rule discipline the env-contract guard uses.
 */
export const PUBLISHED_SUPER_ADMIN_PASSWORDS = [
  'a-strong-password-of-12-chars-or-more',
  'ChangeMe_SuperAdmin_2026',
] as const;

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

  REDIS_URL: Joi.string().required(),

  // ----------------------------------------------------------- 4 MESSAGING

  NATS_URL: Joi.string().required(),
  NATS_MONITOR_URL: Joi.string().uri().required(),

  // --------------------------------------------------------------- 5 PEERS

  // The gRPC client pointed at storage-service, for avatar uploads. Required
  // rather than optional: an avatar endpoint that silently 500s because a URL
  // was never configured is worse than a service that refuses to boot.
  STORAGE_SERVICE_URL: Joi.string().required(),

  // ------------------------------------------------------- 6 AUTH & SECRETS

  // This service mints and verifies tokens; it never writes cookies.
  // The *_NAME and COOKIE_* vars are api-gateway concerns and are validated there.
  JWT_ACCESS_PRIVATE_KEY_PATH: Joi.string().required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().required(),

  // NOTE: there is deliberately no JWT_REFRESH_SECRET. The refresh token is an
  // opaque random string looked up in `device_sessions` on every use, which is
  // what makes it revocable; a self-validating JWT cannot be revoked before it
  // expires. Anyone reintroducing a refresh *secret* here is turning it back
  // into a JWT and losing that property.
  REFRESH_TOKEN_TTL_DAYS: Joi.number().required(),

  // How long "remember this device" suppresses the 2FA prompt.
  TRUSTED_DEVICE_TTL_DAYS: Joi.number().required(),

  PASSWORD_RESET_TTL_MINUTES: Joi.number().required(),

  // The 2FA challenge token has its OWN RS256 pair, separate from the access
  // token's. Separate keys mean the signature itself distinguishes the two token
  // types, and either pair can be rotated without invalidating the other.
  // No shared symmetric secret exists in this system.
  JWT_2FA_PRIVATE_KEY_PATH: Joi.string().required(),
  JWT_2FA_EXPIRES_IN: Joi.string().required(),

  // TTL of the tenant-selection token issued when one address + password
  // matches accounts in several tenants. Signed with the 2FA keypair — same
  // trust domain — so it needs no key path of its own.
  JWT_TENANT_SELECTION_EXPIRES_IN: Joi.string().required(),

  // Encrypts users.two_factor_secret at rest. A TOTP secret must be readable
  // to verify a code, so it cannot be hashed -- see encryptSecret().
  // Rotating this without re-encrypting every stored secret breaks 2FA for
  // every enrolled user.
  //
  // No constant for the `32`, deliberately. A constant earns its place when
  // two things must AGREE — `MIN_PASSWORD_LENGTH` below is the counterpart,
  // because the platform's password policy and this schema are two readers
  // of one number. This 32 agrees with nothing: it is a floor on a key
  // length, chosen here, read once. Naming it would add a lookup without
  // adding a tie.
  TWO_FACTOR_MASTER_KEY: Joi.string().required().min(32),

  // How many 30s steps either side of "now" a TOTP code stays valid. Each step
  // widens the window an intercepted code is replayable in; 1 covers ordinary
  // phone clock drift.
  TWO_FACTOR_TIME_TOLERANCE: Joi.number().required(),

  BACKUP_CODES_PER_USER: Joi.number().required(),
  BACKUP_CODES_LOW_WARNING_THRESHOLD: Joi.number().required(),
  BACKUP_CODE_TTL_DAYS: Joi.number().required(),

  BCRYPT_ROUNDS: Joi.number().required(),

  OTP_LENGTH: Joi.number().required(),
  OTP_EXPIRY_MINUTES: Joi.number().required(),
  OTP_MAX_ATTEMPTS: Joi.number().required(),

  // --------------------------------------------------------- 7 THIRD PARTY

  // Path to the service-account JSON downloaded from the Firebase console,
  // relative to the service root. Used to verify the Google ID tokens the
  // browser obtains via the Firebase client SDK.
  //
  // A path rather than the credentials themselves: the private key is a
  // multi-line PEM, and an env var can only hold it with escaped newlines that
  // then have to be un-escaped correctly. The OAuth client id/secret pair is not
  // needed at all — Firebase runs that exchange, and this service only checks
  // signatures.
  //
  // NEVER commit this file. It is a bearer credential for the whole project.
  FIREBASE_SERVICE_ACCOUNT_PATH: Joi.string().required(),

  // Billing — OPTIONAL, and deliberately so.
  //
  // Every existing tenant is grandfathered: no Stripe objects at all, and on
  // the day this ships that is all of them. A service that refused to boot
  // without billing configured would take down LOGIN for a system where
  // billing is not yet in use — so the keys are optional and `StripeService`
  // degrades to UNAVAILABLE on the billing endpoints alone.
  STRIPE_SECRET_KEY: Joi.string().optional(),
  STRIPE_WEBHOOK_SECRET: Joi.string().optional(),

  // -------------------------------------------------------------- 8 POLICY

  // Shown as the issuer in the user's authenticator app.
  APP_NAME: Joi.string().required(),

  // Mail and SMS delivery moved to notification-service (Domain E); this
  // service only publishes NATS commands and holds no provider credentials.
  // Base URL of the SPA, used to build the links inside those notifications.
  APP_WEB_URL: Joi.string().uri().required(),

  // How long an invitation link stays redeemable. Also the window over which a
  // PENDING invite reserves a seat, so it is a quota knob as much as a
  // security one.
  INVITATION_TTL_DAYS: Joi.number().required(),

  // Mirrors every audit event to the log as well as publishing it to NATS.
  // A stopgap until ticket-service owns `audit_logs` and subscribes — see the
  // docblock on AuditPublisher. Set false once a real consumer exists.
  AUDIT_LOG_TO_CONSOLE: Joi.boolean().default(true),

  // ------------------------------------------------- 9 BOOTSTRAP IDENTITIES
  //
  // **Not "development".** These four create a platform super-administrator
  // and the system actor on first boot, in every environment — the heading
  // that used to sit here said `9 DEVELOPMENT`, which is what made a
  // `default(true)` beside a published password look harmless.

  // Whether the seeder inserts ROWS. It no longer gates the schema objects:
  // Prisma cannot express partial indexes or CHECK constraints, so the seeder
  // applies those on every boot regardless — see `applySchemaObjects()`. This
  // is the only service where the flag ever meant anything, because it is the
  // only one that seeds rows at all.
  //
  // `required()`, like its three former peers had: an unset seeding flag
  // should stop a service rather than choose for it, and the default said yes
  // to creating a super-admin from environment variables.
  SEED_ON_BOOTSTRAP: Joi.boolean().required(),

  // The non-login platform actor that owns rows no human created — currently
  // roles.created_by_id on the global system roles.
  // `tlds: false` because this address is deliberately UNDELIVERABLE — the
  // system actor is not a mailbox, and the convention for it is a reserved TLD
  // (`system@synapsedesk.internal`). Joi's default checks the TLD against the
  // IANA list, which rejects `.internal` precisely because nothing may route
  // there. Validating the syntax is still worth doing; validating routability
  // is the opposite of what this field wants.
  SYSTEM_USER_EMAIL: Joi.string()
    .email({ tlds: { allow: false } })
    .required(),
  SYSTEM_USER_FULL_NAME: Joi.string().required(),

  // The first real Super Admin account. The password is only applied when the
  // account is created; rotating it later is done through the API, not here.
  SUPER_ADMIN_EMAIL: Joi.string().email().required(),
  SUPER_ADMIN_FULL_NAME: Joi.string().required(),
  // FIXME Don't reference to impl doc!
  // **A list of PUBLISHED values, not of weak ones.** Length is already
  // `min(12)`'s job and both of these pass it — the first is 37 characters.
  // What makes them dangerous is that a reader can look them up: one ships in
  // `.env.example`, the file doc 70 made the contract a deployer follows, and
  // the other is in the tracked `.env.test` and rides into `.env.docker`
  // through `scripts/generate-docker-env.mjs`. A deployment that follows the
  // documented process and edits every line but this one would otherwise get a
  // super-administrator whose password is in the repository.
  //
  // **Refused everywhere EXCEPT `NODE_ENV=test`, and that exemption is the
  // point rather than a concession.** `.env.test` supplies the second value —
  // measured: refusing it unconditionally failed all 471 auth e2e tests at
  // `ConfigModule.forRoot` — and a tracked test fixture is not a deployment.
  // Every published value stays refused in the environments where "published"
  // means "an attacker can read it too".
  SUPER_ADMIN_PASSWORD: Joi.string()
    .min(MIN_PASSWORD_LENGTH)
    .required()
    .when('NODE_ENV', {
      is: 'test',
      otherwise: Joi.string().invalid(...PUBLISHED_SUPER_ADMIN_PASSWORDS),
    }),
});
