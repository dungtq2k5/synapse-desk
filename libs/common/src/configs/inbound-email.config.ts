/**
 * Inbound email addressing
 *
 * **One definition, three readers.** The Cloudflare Worker builds nothing but
 * forwards the recipient verbatim; the gateway parses it to find the tenant and
 * the thread; notification-service writes it into `Reply-To` on the way out. A
 * second spelling of this format in any one of them is mail that routes in
 * tests and drops in production.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * The fixed local part every inbound address begins with.
 *
 * A single catch-all route (`support+*@domain`) delivers all of them, which is
 * what keeps this to one MX record and no wildcard DNS.
 */
export const INBOUND_LOCAL_PART = 'support';

/**
 * Separates the tenant token from the per-ticket reply token.
 *
 * `support+{tenant}.{ticket}@…` — a dot rather than a second `+`, because some
 * mail systems treat everything after the FIRST `+` as one sub-address label
 * and a few strip repeated `+` segments entirely. A dot is an ordinary
 * local-part character that nothing rewrites.
 */
export const INBOUND_TOKEN_SEPARATOR = '.';

/** Bytes of entropy behind a tenant token — 128 bits, hex-encoded to 32 chars. */
const INBOUND_TOKEN_BYTES = 16;

/**
 * A tenant's inbound token: 32 lowercase hex characters.
 *
 * **Hex, not `generateSecureToken()`**. That helper produces 43
 * `base64url` characters, which does not fit `organizations.inbound_token` and,
 * far worse, is CASE-SENSITIVE: local-part case is preserved in theory and
 * normalised by plenty of real mail systems in practice, so one hop lowercasing
 * the address would unroute that tenant permanently — indistinguishable from
 * nobody emailing them. Hex is single-case, so a normalising hop is a no-op.
 */
export function generateInboundToken(): string {
  return randomBytes(INBOUND_TOKEN_BYTES).toString('hex');
}

/** Matches a tenant token exactly — 32 lowercase hex characters. */
const TENANT_TOKEN = /^[0-9a-f]{32}$/;

/** What an inbound recipient address resolves to. */
export type InboundAddress = {
  /** `organizations.inbound_token`. */
  tenantToken: string;
  /**
   * The per-ticket reply token, when the sender replied to a notification.
   *
   * An HMAC of the ticket id rather than the id itself. A raw id
   * would let anyone who can construct the address post into any ticket;
   * holding the HMAC is the authorization, which is what a reply is.
   */
  ticketToken: string | null;
};

/**
 * Parses `support+{tenant}[.{ticket}]@domain`.
 *
 * **Returns `null` rather than throwing, and the caller drops.** An unroutable
 * address is not an error condition — it is a public address receiving mail
 * nobody could route, which happens constantly and must cost a log line rather
 * than an exception.
 *
 * Case is normalised before matching, for the reason
 * {@link generateInboundToken} explains: a hop that lowercases the local part
 * must not change the answer.
 */
export function parseInboundAddress(recipient: string): InboundAddress | null {
  const at = recipient.lastIndexOf('@');
  const local = (at === -1 ? recipient : recipient.slice(0, at))
    .trim()
    .toLowerCase();

  const plus = local.indexOf('+');
  if (plus === -1) return null;
  if (local.slice(0, plus) !== INBOUND_LOCAL_PART) return null;

  const [tenantToken, ticketToken, ...rest] = local
    .slice(plus + 1)
    .split(INBOUND_TOKEN_SEPARATOR);

  // A third segment is not a token this system issued. Refused rather than
  // ignored: silently accepting a prefix would make several distinct addresses
  // route to one tenant, which is the enumeration the token exists to prevent.
  if (rest.length > 0) return null;
  if (!TENANT_TOKEN.test(tenantToken)) return null;

  return { tenantToken, ticketToken: ticketToken || null };
}

/**
 * Builds the address a tenant publishes, or the `Reply-To` for one ticket.
 *
 * `domain` is the mail domain the catch-all route serves — configuration, never
 * derived from the tenant, because the MX record is per deployment and not per
 * tenant.
 */
export function buildInboundAddress(
  domain: string,
  tenantToken: string,
  ticketToken?: string,
): string {
  const suffix = ticketToken ? `${INBOUND_TOKEN_SEPARATOR}${ticketToken}` : '';

  return `${INBOUND_LOCAL_PART}+${tenantToken}${suffix}@${domain}`;
}

/**
 * How many hex characters of the MAC ride in a reply address.
 *
 * 12 hex = 48 bits. Small for a stored secret and ample here, because forging
 * one is an ONLINE attack: every guess costs an email that must be delivered,
 * accepted and processed, and a wrong guess opens a new ticket rather than
 * revealing anything. The binding constraint is the opposite one — RFC 5321
 * caps a local part at 64 octets, and `support+` plus a 32-character tenant
 * token plus a separator has already spent 41 of them.
 */
const REPLY_MAC_CHARS = 12;

/** Splits the ticket number from its MAC. `-` is not the label separator. */
const REPLY_TOKEN_SEPARATOR = '-';

/**
 * The largest ticket number a reply ADDRESS can carry — 36^8 - 1, about 2.8
 * trillion per tenant.
 *
 * **A stated ceiling rather than an assumption, because the budget is fixed and
 * small.** RFC 5321 caps a local part at 64 octets, and `support+` (8) plus the
 * tenant token (32) plus the label separator (1) spends 41 of them before the
 * ticket is named at all. That leaves 23 for `{base36 number}-{12-char MAC}`,
 * so the number gets 10 — and 8 is the round figure below it.
 *
 * `ticket_number` is a `bigserial`, so the TYPE allows far more than this. What
 * happens above the ceiling is not corruption: the address simply grows past 64
 * octets, which some MTAs refuse — and the symptom is replies quietly failing
 * to thread for one tenant, which is exactly the kind of failure that takes a
 * week to attribute. Recorded here so the next person meets a number rather
 * than a surprise.
 */
export const MAX_ADDRESSABLE_TICKET_NUMBER = 36 ** 8 - 1;

/**
 * The per-ticket half of a reply address.
 *
 * `{base36 ticket number}-{MAC}`, so it is both **readable back** and
 * **unforgeable**:
 *
 *   - A raw ticket id would let anyone who can construct an address post into
 *     any ticket. Possessing a valid address is the authorization, which is
 *     exactly what replying to an email is.
 *   - A bare MAC of the id would be unforgeable and USELESS, because an HMAC
 *     cannot be inverted — the address has to say which ticket it belongs to,
 *     or resolving it needs a stored column and an index. Carrying the number
 *     in the clear and authenticating it with the MAC gets both properties and
 *     needs no schema.
 *
 * **The tenant is inside the MAC**, so a token minted for one tenant does not
 * verify against another — a reply address cannot be replayed sideways even
 * though the ticket NUMBER is per-tenant and therefore repeats across them.
 */
export function buildTicketReplyToken(
  organizationId: string,
  ticketNumber: number,
  secret: string,
): string {
  const number = ticketNumber.toString(36);

  return `${number}${REPLY_TOKEN_SEPARATOR}${replyMac(organizationId, ticketNumber, secret)}`;
}

/**
 * The ticket number a reply token attests to, or `null`.
 *
 * `null` covers every failure — malformed, wrong tenant, altered number,
 * altered MAC — and the caller treats all of them the same way: open a NEW
 * ticket. That is the safe direction: a duplicate ticket is
 * annoying and visible, while threading a stranger's mail onto somebody else's
 * conversation is a disclosure.
 */
export function parseTicketReplyToken(
  token: string,
  organizationId: string,
  secret: string,
): number | null {
  const [encoded, mac, ...rest] = token.split(REPLY_TOKEN_SEPARATOR);
  if (!encoded || !mac || rest.length > 0) return null;

  // `parseInt` with an explicit radix, then a round-trip check: `parseInt`
  // stops at the first invalid character, so `'12x'` would otherwise become 12
  // and verify against a MAC that was never issued for it.
  const ticketNumber = Number.parseInt(encoded, 36);
  if (!Number.isSafeInteger(ticketNumber) || ticketNumber <= 0) return null;
  if (ticketNumber.toString(36) !== encoded) return null;

  const expected = replyMac(organizationId, ticketNumber, secret);

  // Constant-time, on the same reasoning as every other MAC compare here. The
  // channel is weak over email latency; closing it is free.
  const given = Buffer.from(mac, 'hex');
  const want = Buffer.from(expected, 'hex');
  if (given.length !== want.length || given.length === 0) return null;

  return timingSafeEqual(given, want) ? ticketNumber : null;
}

function replyMac(
  organizationId: string,
  ticketNumber: number,
  secret: string,
): string {
  return createHmac('sha256', secret)
    .update(`${organizationId}:${ticketNumber}`)
    .digest('hex')
    .slice(0, REPLY_MAC_CHARS);
}
