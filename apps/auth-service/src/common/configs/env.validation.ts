import * as Joi from 'joi';
import { LOG_LEVELS, NODE_ENV_OPTIONS } from '@synapsedesk/common';

export const envValidationSchema = Joi.object({
  // The gRPC client pointed at storage-service, for avatar uploads. Required
  // rather than optional: an avatar endpoint that silently 500s because a URL
  // was never configured is worse than a service that refuses to boot.
  STORAGE_SERVICE_URL: Joi.string().required(),

  DATABASE_URL: Joi.string().required(),

  REDIS_URL: Joi.string().required(),

  NATS_URL: Joi.string().required(),

  GRPC_HOST: Joi.string().required(),
  GRPC_PORT: Joi.number().required(),

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

  // How long an invitation link stays redeemable. Also the window over which a
  // PENDING invite reserves a seat, so it is a quota knob as much as a
  // security one.
  INVITATION_TTL_DAYS: Joi.number().required(),

  // Shown as the issuer in the user's authenticator app.
  APP_NAME: Joi.string().required(),

  // Encrypts users.two_factor_secret at rest. A TOTP secret must be readable
  // to verify a code, so it cannot be hashed -- see encryptSecret().
  // Rotating this without re-encrypting every stored secret breaks 2FA for
  // every enrolled user.
  TWO_FACTOR_MASTER_KEY: Joi.string().required().min(32),

  // How many 30s steps either side of "now" a TOTP code stays valid. Each step
  // widens the window an intercepted code is replayable in; 1 covers ordinary
  // phone clock drift.
  TWO_FACTOR_TIME_TOLERANCE: Joi.number().required(),

  BACKUP_CODES_PER_USER: Joi.number().required(),
  BACKUP_CODES_LOW_WARNING_THRESHOLD: Joi.number().required(),
  BACKUP_CODE_TTL_DAYS: Joi.number().required(),

  BCRYPT_ROUNDS: Joi.number().required(),

  // Mail and SMS delivery moved to notification-service (Domain E); this
  // service only publishes NATS commands and holds no provider credentials.
  // Base URL of the SPA, used to build the links inside those notifications.
  APP_WEB_URL: Joi.string().uri().required(),

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

  GITHUB_CLIENT_ID: Joi.string().required(),
  GITHUB_CLIENT_SECRET: Joi.string().required(),

  OTP_LENGTH: Joi.number().required(),
  OTP_EXPIRY_MINUTES: Joi.number().required(),
  OTP_MAX_ATTEMPTS: Joi.number().required(),

  // Mirrors every audit event to the log as well as publishing it to NATS.
  // A stopgap until ticket-service owns `audit_logs` and subscribes — see the
  // docblock on AuditPublisher. Set false once a real consumer exists.
  AUDIT_LOG_TO_CONSOLE: Joi.boolean().default(true),

  // Bootstrap seeding (see src/modules/prisma/database.seeder.ts). Runs on every startup and is
  // idempotent; set SEED_ON_BOOTSTRAP=false to skip it entirely.
  SEED_ON_BOOTSTRAP: Joi.boolean().default(true),

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
  SUPER_ADMIN_PASSWORD: Joi.string().min(12).required(),

  NODE_ENV: Joi.string()
    .required()
    .valid(...NODE_ENV_OPTIONS),
  LOG_LEVEL: Joi.string()
    .required()
    .valid(...LOG_LEVELS),

  // ---------------------------------------------------------------------
  // Billing — OPTIONAL, and deliberately so (14-doc §2.1).
  //
  // Every existing tenant is grandfathered: no Stripe objects at all, and on
  // the day this ships that is all of them. A service that refused to boot
  // without billing configured would take down LOGIN for a system where
  // billing is not yet in use — so the keys are optional and `StripeService`
  // degrades to UNAVAILABLE on the billing endpoints alone.
  // ---------------------------------------------------------------------
  STRIPE_SECRET_KEY: Joi.string().optional(),
  STRIPE_WEBHOOK_SECRET: Joi.string().optional(),
  // JSON keyed by price id. Absent means the built-in test-mode catalog, which
  // is what lets a fresh clone run the suite.
  STRIPE_PLAN_CATALOG: Joi.string().optional(),
});
