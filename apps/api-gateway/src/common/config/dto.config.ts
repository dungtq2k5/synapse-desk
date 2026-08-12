/**
 * Bounds for REQUEST DTOs, and nothing else.
 *
 * Every constant here guards the shape of an incoming body or query, and
 * nothing here is a policy: `MAX_INVITATIONS_PER_BATCH` stops one call carrying
 * 50,000 addresses, while `organizations.max_agent_seats` is what limits how
 * many invitations may exist. The two are easy to confuse and live in different
 * services for exactly that reason.
 *
 * Named `dto.config` rather than `app.config` because the previous name invited
 * anything vaguely global — the throttler policy and a duplicate of the REST
 * envelope types had both accumulated here.
 */

export const MIN_FULL_NAME_LENGTH = 2;
export const MAX_FULL_NAME_LENGTH = 150;

export const MAX_DEVICE_NAME_LENGTH = 100;

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
 * Upper bound on one "add members" call. Guards the REQUEST BODY only; the
 * tenant check on every id is what enforces correctness.
 */
export const MAX_DEPARTMENT_MEMBERS_PER_BATCH = 500;

export const MIN_ROLE_NAME_LENGTH = 2;
/** Matches `roles.name` — `@db.VarChar(100)`. */
export const MAX_ROLE_NAME_LENGTH = 100;

/** A document belongs to a handful of departments, not hundreds. */
export const MAX_DOCUMENT_DEPARTMENTS = 50;

// SORT_ORDER_OPTIONS / SortOrder / DEFAULT_SEARCH moved to @synapsedesk/common:
// auth-service clamps `limit` a second time (it is reachable over gRPC, where no
// ValidationPipe ever ran), and two copies of MAX_LIMIT is how the edge and the
// service end up disagreeing about what "too many" means.

// ------------------------------------------------------- inbound email
//
// The webhook's caller is authenticated by signature, which proves the Worker
// sent the body and nothing about what a stranger put in the mail. Every one of
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
