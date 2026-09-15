/**
 * @file Bounds for REQUEST DTOs, and nothing else.
 *
 * Every constant here guards the shape of an incoming body or query, and
 * nothing here is a policy: `MAX_INVITATIONS_PER_BATCH` stops one call carrying
 * 50,000 addresses, while `organizations.max_agent_seats` is what limits how
 * many invitations may exist. The two are easy to confuse and live in different
 * services for exactly that reason.
 */

export const MIN_FULL_NAME_LENGTH = 2;
export const MAX_FULL_NAME_LENGTH = 150;

export const MAX_DEVICE_NAME_LENGTH = 100;

/**
 * Matches Prisma's `device_tokens.token` column width.
 *
 * A bound rather than a spec: FCM's registration tokens are ~150-250 characters
 * and the format is theirs to change, so the column is generous and this
 * refuses only what could not be stored.
 */
export const MAX_DEVICE_TOKEN_LENGTH = 512;

/**
 * Upper bound on one invitation batch.
 *
 * Guards the REQUEST BODY, not the seat quota — `organizations.max_agent_seats`
 * is what limits how many invitations may actually exist, and auth-service
 * enforces that. This only stops a single call arriving with 50,000 addresses.
 */
export const MAX_INVITATIONS_PER_BATCH = 200;

export const MIN_DEPARTMENT_NAME_LENGTH = 2;

/** Matches `departments.name` — `@db.VarChar(100)`. A longer value would pass
 * validation and then fail as a Postgres error, which reads as a 500. */
export const MAX_DEPARTMENT_NAME_LENGTH = 100;

/**
 * How many attachments ONE inbound mail may carry into the webhook's DTO.
 *
 * **Deliberately larger than `MAX_ATTACHMENTS_PER_MESSAGE`.** A mail with eight
 * attachments is a real mail: the eligible ones are ingested up to the tenant's
 * per-message cap and the rest are named in the ticket's "not accepted" note.
 * The twenty-first is where a list stops being a mail and starts being a
 * payload, so the mapper keeps the first twenty and names every one after them
 * — the mail itself still passes validation.
 */
export const MAX_PRESENTED_ATTACHMENTS = 20;

/**
 * Upper bound on one "add members" call. Guards the REQUEST BODY only; the
 * tenant check on every id is what enforces correctness.
 */
export const MAX_DEPARTMENT_MEMBERS_PER_BATCH = 500;

export const MIN_ROLE_NAME_LENGTH = 2;
/** Matches `roles.name` — `@db.VarChar(100)`. */
export const MAX_ROLE_NAME_LENGTH = 100;

/** A document belongs to a handful of departments, not hundreds. */
export const MAX_DOCUMENT_DEPARTMENTS = 50;

/**
 * Users per bulk role assignment.
 *
 * **The bound and the transaction budget are one decision**, so the arithmetic
 * lives here. The service applies the change through `setUserRoles` PER USER,
 * inside a single interactive transaction: a role load, a current-set read, a
 * `user.update`, up to two counter updates, and a `user.count` when `ORG_ADMIN`
 * is leaving — five to six serialized round trips each.
 *
 * ```
 *  | Users | Round trips | @2ms (local) | @10ms (managed Postgres) |
 *  | :---- | :---- | :---- | :---- |
 *  | 100 | 500–600 | ~1.1 s | **5–6 s** |
 *  | 50 | 250–300 | ~0.6 s | ~3 s |
 * ```
 *
 * Prisma's default interactive-transaction timeout is **5 seconds**, so 100 is
 * at or over it the moment the database is a network hop away — which is
 * exactly the shape that passes in testing and fails on the one tenant with 100
 * people to add. 50 halves the worst case and is still 2.5× the plan's
 * motivating "add 20 people to this role".
 *
 * The service also passes an explicit `timeout`; this cap is the other half of
 * that pair, not a substitute for it.
 */
export const MAX_ROLE_ASSIGNMENT_USERS = 50;

// ------------------------------------------------------------ uploads

/** Longest file name a presign DTO accepts. */
export const MAX_UPLOAD_FILE_NAME_LENGTH = 255;

// ------------------------------------------------------------- free text

/** Longest instruction accepted when steering an AI draft. */
export const MAX_DRAFT_INSTRUCTION_LENGTH = 500;

// ---------------------------------------------------- notification feed

/** Most notification ids one bulk-read may carry. */
export const MAX_BULK_NOTIFICATION_IDS = 200;

/** Longest notification feed cursor accepted. */
export const MAX_FEED_CURSOR_LENGTH = 500;

/** Page size for the cursor-paginated notification feed. */
export const NOTIFICATION_FEED_LIMIT = {
  DEFAULT: 20,
  MAX: 100,
} as const;

// ------------------------------------------------------- inbound email
//
// The webhook is authenticated by signature, which proves Resend sent the
// delivery and nothing about what a stranger put in the mail. Every one of
// these bounds an attacker-controlled header.

/** RFC 5321's maximum path: 64-octet local part, 255-octet domain, `@`. */
export const MAX_EMAIL_ADDRESS_LENGTH = 320;

/** RFC 5322's maximum line — the ceiling on any single unfolded header. */
export const MAX_HEADER_LINE_LENGTH = 998;

/**
 * How long a `Message-ID` may be, in characters AND bytes.
 *
 * Matches `inbound_emails.message_id`'s `VarChar(255)`, and the two agree only
 * because the DTO also constrains the field to printable ASCII — a validator
 * counts characters while Postgres counts bytes. The column is half of a unique
 * index, and Postgres refuses index tuples past roughly 2704 bytes, so an
 * unbounded multibyte header would pass validation and then fail the insert
 * with an error that is not a duplicate-key error: a 5xx the provider retries
 * forever. Real Message-IDs are far under this.
 */
export const MAX_MESSAGE_ID_LENGTH = 255;

/** RFC 5322 `msg-id` is printable ASCII, and that is what makes bytes and
 * characters the same number for {@link MAX_MESSAGE_ID_LENGTH}. */
export const PRINTABLE_ASCII = /^[\x21-\x7E]+$/;

/**
 * How long a `Date` header may be.
 *
 * RFC 5322 `date-time` is under 40 characters even with a comment and an
 * obsolete zone name, so this is slack rather than a limit anyone reaches. It
 * is bounded at all because the value is hashed into the idempotency key for a
 * message with no `Message-ID`, and an unbounded header would let one field
 * decide how much a digest costs.
 */
export const MAX_DATE_HEADER_LENGTH = 255;

/**
 * Most results one knowledge search may ask for.
 *
 * A request-body bound, not a retrieval policy: rag-service clamps to its own
 * `final_context_k` regardless of what arrives.
 */
export const MAX_KNOWLEDGE_SEARCH_LIMIT = 50;

/**
 * The `limit` a knowledge search sends when the caller does not choose one.
 *
 * Zero is rag-service's documented "use the configured default" — its
 * `_clamped_limit(requested, final_context_k)` falls back whenever the value is
 * not positive, so the gateway does not have to know what that default is.
 */
export const DEFAULT_KNOWLEDGE_SEARCH_LIMIT = 0;

// ------------------------------------------------------------ organizations
//
// One tenant, two surfaces: `/platform/*` (Super Admin, may set quotas) and
// `/organizations/*` (the tenant editing itself). The bounds are the same on
// both, which is the reason they are here rather than beside either DTO.

/** Matches `organizations.name` — `@db.VarChar(255)`. */
export const MAX_ORGANIZATION_NAME_LENGTH = 255;
export const MIN_ORGANIZATION_NAME_LENGTH = 2;

/** Matches `organizations.slug` — `@db.VarChar(100)`, and `@unique`. */
export const MAX_ORGANIZATION_SLUG_LENGTH = 100;
export const MIN_ORGANIZATION_SLUG_LENGTH = 2;

// The slug format moved to `@synapsedesk/common` (organization.config.ts):
// it is a contract between auth-service's generator and this gateway's
// validators, and a gateway spec asserting the producer's conformance had to
// reach across workspaces to do it — an import a pruned image build refuses.
// Re-exported so the gateway's DTO imports stay local.
export { ORGANIZATION_SLUG_PATTERN } from '@synapsedesk/common';

/** Matches `organizations.allowed_email_domains` — `@db.VarChar(255)`. */
export const MAX_ORGANIZATION_DOMAIN_LENGTH = 255;

/**
 * The shape a domain must have: ASCII hostname labels, at least one dot.
 *
 * **A format rule, so emoji fall out as a side effect rather than as the
 * target.** An emoji rule alone would be the same category error as putting one
 * on `slug`: it refuses one bad class and leaves spaces, `@`, `/` and `..`
 * accepted in a field compared against the domain half of an email address.
 *
 * **This is the only layer that validates.** auth-service normalizes —
 * `.trim().toLowerCase()` in `platform.service.ts` and
 * `organizations.service.ts` — but none of those sites is reachable by a
 * `ValidationPipe`, so without this rule `🎉.COM ` was tidied and stored,
 * leaving the field neat and meaningless.
 *
 * **ASCII only, which means punycode.** `münchen.de` is refused rather than
 * accepted-and-mangled: nothing in the stack punycodes, so accepting the
 * Unicode form would let one domain be stored two ways and match neither
 * reliably. IDN needs the conversion to happen BEFORE the comparison, not a
 * wider pattern here.
 */
export const ORGANIZATION_DOMAIN_PATTERN =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * How many domains one tenant may allow for self-signup.
 *
 * Bounds the request body. Each entry is itself capped by
 * {@link MAX_ORGANIZATION_DOMAIN_LENGTH}, matching the `VarChar(255)` on
 * `organizations.allowed_email_domains`.
 */
export const MAX_ALLOWED_EMAIL_DOMAINS = 50;

/**
 * The free-text reason a privileged action carries into `audit_logs`.
 *
 * Shared by every "why did you do that" field — suspend, reset billing cycle,
 * offboard, delete. One bound because they are one kind of thing: the answer to
 * "why is Acme frozen?", read six months later by somebody else.
 */
export const MAX_ADMIN_REASON_LENGTH = 500;

/** `roles.description` is `@db.Text`; this bounds the REQUEST, not the column. */
export const MAX_ROLE_DESCRIPTION_LENGTH = 2000;

/**
 * Floors for the tenant quotas a Super Admin sets.
 *
 * Seats start at one because a tenant with zero could never be used. Storage and
 * token budget start at zero, which is a real setting: a suspended tenant keeps
 * its data and spends nothing.
 */
export const MIN_AGENT_SEATS = 1;
export const MIN_STORAGE_BYTES = 0;
export const MIN_AI_TOKEN_BUDGET = 0;

// -------------------------------------------------------- codes & secrets

/**
 * The range a submitted OTP may fall in.
 *
 * **A range, not a fixed length, and deliberately.** auth-service generates
 * `OTP_LENGTH` digits and that is an ENV VAR — the gateway cannot know what a
 * given deployment set it to, so this bounds the field without claiming to know
 * the exact length. The real check is auth-service comparing the hash.
 */
export const MIN_OTP_CODE_LENGTH = 4;
export const MAX_OTP_CODE_LENGTH = 10;

/** TOTP is six digits — RFC 6238's default, and what the authenticator shows. */
export const TOTP_CODE_LENGTH = 6;

/** Bounds an id accepted for PREVIEW, where the point is to take bad data and report on it. */
export const MAX_PREVIEW_ID_LENGTH = 64;

// ------------------------------------------------------------- free text

/** `departments.description` is `@db.Text`; this bounds the REQUEST. */
export const MAX_DEPARTMENT_DESCRIPTION_LENGTH = 2000;

/** Longest reason accepted when locking an account. */
export const MAX_LOCK_REASON_LENGTH = 500;

/** One knowledge query. A 50,000-character "query" is one embedding call charged to the tenant. */
export const MAX_KNOWLEDGE_QUERY_LENGTH = 1_000;

/**
 * One `/knowledge/ask` question.
 *
 * Wider than a search query because a question carries context a keyword search
 * does not — but still bounded: this text is embedded AND fed to a generator,
 * so an unbounded body is two costs, not one.
 */
export const MAX_KNOWLEDGE_QUESTION_LENGTH = 4_000;

/** Stripe price ids are opaque; this only stops an unbounded string reaching the API. */
export const MAX_BILLING_PRICE_ID_LENGTH = 255;

/**
 * The validation every Stripe redirect URL in this file gets.
 *
 * All three fields are the same thing — a URL we hand to Stripe, which Stripe
 * later hands to a BROWSER — so they share one rule rather than three copies
 * that can drift. A copy that lost `protocols` would still look like
 * validation while accepting `javascript:` or `data:`, and nothing at the call
 * site would show the difference.
 *
 * `require_tld: false` so a `localhost` redirect works in development —
 * **unconditionally, never switched by environment.** Three reasons, and the
 * third is the one that settles it:
 *
 * - A rule that is looser in development passes review, passes CI, and fails in
 *   production on a URL nobody tested. The failure lands on the redirect AFTER
 *   payment, which is the worst place in this flow for it.
 * - It is not the security control. `protocols` is what refuses `javascript:`
 *   and `data:`; a TLD stops nothing an attacker would try.
 * - **The party receiving the URL is strict.** Live-mode Checkout and Portal
 *   refuse non-HTTPS redirect URLs themselves, so a `localhost` success URL
 *   cannot reach production undetected regardless of what this validator does.
 *   Being lax here is safe precisely because Stripe is not.
 */
export const STRIPE_REDIRECT_URL = {
  require_tld: false,
  protocols: ['http', 'https'],
};

/**
 * Ceiling on a password-reset token arriving in a request body.
 *
 * A bound, not the token's length: auth-service generates 32 random bytes as
 * base64url (43 characters) and this only stops an unbounded string reaching a
 * hash-and-lookup. Generous on purpose — the gateway must not break when the
 * generator's byte count changes.
 */
export const MAX_RESET_TOKEN_LENGTH = 256;

// ------------------------------------------------------------- The plan catalogue

export const MIN_PLAN_NAME_LENGTH = 2;
export const MAX_PLAN_NAME_LENGTH = 100;

/**
 * Stripe ids (`prod_…`, `price_1Ox…`).
 *
 * Matches the column, which is `VarChar(255)`: a DTO that admitted more would
 * turn a typo into a Prisma error at write time instead of a 400 at the edge.
 */
export const MAX_STRIPE_ID_LENGTH = 255;

/**
 * Stripe's own vocabulary, not ours.
 *
 * Kept as strings rather than an enum for the reason the column is a `VarChar`:
 * a new interval Stripe supports must not need a proto change to express.
 */
export const PLAN_BILLING_INTERVALS = ['month', 'year'] as const;
export type PlanBillingInterval = (typeof PLAN_BILLING_INTERVALS)[number];

/** Billing variants of ONE plan. Two is the real case; the cap is a sanity bound. */
export const MAX_PLAN_PRICES = 12;

/**
 * The character class a Stripe object id may use.
 *
 * NOT a `^price_` / `^prod_` prefix check: Stripe's id format is a convention
 * rather than a documented contract, and an id that is locally well-formed but
 * does not exist fails on the next API call exactly as a malformed one does. A
 * prefix rule would be this repo maintaining a third party's naming scheme.
 *
 * What this refuses is an absurd string being carried into an API call —
 * whitespace, punctuation, anything that could only be a paste accident.
 */
export const STRIPE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * A calendar date, `YYYY-MM-DD`.
 *
 * Stricter than `@IsISO8601()` on purpose. That accepts a full timestamp, and a
 * range parameter that quietly accepts one invites a caller to believe it
 * selects a sub-day window — the series is bucketed by UTC day and no such
 * window exists. The refusal is at the edge, where the message can say so.
 */
export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
