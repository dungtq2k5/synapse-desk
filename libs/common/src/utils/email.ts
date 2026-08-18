/** @file Email normalization and the parts an address is read apart into. */

/**
 * The single normalization applied to every address before it is stored or
 * compared (RDM).
 *
 * Shared rather than per-service because the partial unique index
 * `users_org_email_key` is byte-exact: if register lower-cases and invite does
 * not, `John@acme.com` and `john@acme.com` become two accounts in one tenant
 * and the index never notices. Apply at EVERY entry point — register, login,
 * invite, forgot-password, OAuth, seed.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function extractEmailDomain(email: string): string | null {
  if (!email) return null;

  const domain = email.split('@')[1];
  return domain || null;
}

/**
 * The part before the `@` — the stand-in for a display name nobody supplied.
 *
 * `users.full_name` is NOT NULL, and two paths reach it with no name to write:
 * Google sign-in when the provider withholds one, and inbound email from a
 * sender whose `From` carried no display name. Both had spelled this
 * `email.split('@')[0]` inline, which is the shape that quietly returns the
 * WHOLE string for a malformed address — so a value that is not an address at
 * all becomes somebody's name rather than being caught.
 *
 * Returns `null` for anything without a usable local part, mirroring
 * {@link extractEmailDomain}'s shape — the two are siblings and a caller that
 * has both in view should not have to remember which one can surprise it. Both
 * call sites end in `?? email`, because the column still has to be filled.
 */
export function extractEmailLocalPart(email: string): string | null {
  if (!email.includes('@')) return null;

  const local = email.split('@')[0];
  return local || null;
}

/**
 * The bare address out of a `From` header — `"Support" <a@b>` becomes `a@b`.
 *
 * One of the family with {@link extractEmailDomain} and
 * {@link extractEmailLocalPart}: pull one part out of an address a human typed.
 *
 * **Lower-cased, because comparison is the point.** A display name is
 * decoration the sender controls, so a guard comparing whole headers would miss
 * `"SynapseDesk Support" <support@…>` and fail OPEN into the self-loop it
 * exists to stop.
 *
 * Unanchored deliberately: a `From` may carry a comment or an encoded word
 * before the angle brackets, and the first bracketed run is the address in
 * every form of the header that reaches us.
 */
export function extractEmailAddress(value: string): string {
  const angled = /<([^>]+)>/.exec(value); // NOSONAR

  return (angled?.[1] ?? value).trim().toLowerCase();
}
