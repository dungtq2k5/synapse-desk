import { HttpException } from '@nestjs/common';

/**
 * Extract domain from email
 * @param email Email string
 * @returns Domain string or null if invalid email
 */
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
 * **Here rather than beside its one caller, and the spec is what decided it.**
 * The gateway's self-loop guard compares an inbound `From` against
 * `EMAIL_SENDER`, and `env.validation.spec.ts` asserts that the gateway and
 * notification-service name the same address — through this function, because a
 * second spelling in the test would be a test that agrees with itself. That put
 * a spec under `common/config` importing from `modules/inbound-email`, which is
 * the dependency running the wrong way: in this repo `common/` is the mechanism
 * and `modules/` the capability, and mechanisms do not reach into features.
 *
 * Named for the family it joins — {@link extractEmailDomain},
 * {@link extractEmailLocalPart} — all three being "pull one part out of an
 * address a human typed".
 *
 * Comparison is the point, so the result is lower-cased: a display name is
 * decoration a sender controls, and a guard that compared whole headers would
 * miss `"SynapseDesk Support" <support@…>` and fail OPEN into the loop it
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

/**
 * The comparator for sorting strings alphabetically.
 *
 * `Array.prototype.sort()` with no argument compares by UTF-16 code unit, not
 * alphabetically — `'Z'` sorts before `'a'`, and anything non-ASCII sorts by
 * code point rather than by how the alphabet actually reads. For the ASCII
 * identifiers most call sites pass (permission codes, service names, object
 * keys) the two agree, which is exactly what makes the bare form easy to reach
 * for and easy to get wrong the first time a value is a display name, a slug,
 * or anything a user typed.
 *
 * Shared rather than redeclared per file because it had already been written
 * three separate times under three different names, and a comparator that
 * differs between two suites is a test that passes in one and not the other for
 * reasons unrelated to the code under test.
 *
 *   [...codes].sort(compareAlphabetically)
 *
 * Note this does NOT copy: `.sort()` still mutates in place. Spread first when
 * the array belongs to something the assertion also inspects.
 */
export function compareAlphabetically(a: string, b: string): number {
  return a.localeCompare(b);
}

export function formatErrorMsg(
  err: unknown,
  exceptionMsg: string = 'An unknown error occurred',
): string {
  // No `= ''` initializer: the chain below ends in a bare `else`, so every path
  // assigns. Seeding it with a value only hides a missing branch if one is ever
  // added — TypeScript's definite-assignment analysis catches that, an empty
  // string does not.
  let formattedMsg: string;

  if (err instanceof HttpException) {
    const res = err.getResponse() as string | { message?: unknown };

    if (typeof res === 'string') {
      formattedMsg = res;
    } else if (res && typeof res === 'object' && 'message' in res) {
      const msg = res.message;
      if (Array.isArray(msg)) {
        formattedMsg = msg.join(', ');
      } else if (typeof msg === 'string') {
        formattedMsg = msg;
      } else {
        formattedMsg = err.message;
      }
    } else {
      formattedMsg = err.message;
    }
  } else if (err instanceof Error) {
    formattedMsg = err.message;
  } else if (err && typeof err === 'object' && 'message' in err) {
    const msg = err.message;
    if (Array.isArray(msg)) {
      formattedMsg = msg.join(', ');
    } else if (typeof msg === 'string') {
      formattedMsg = msg;
    } else {
      formattedMsg = String(msg);
    }
  } else if (typeof err === 'string') {
    formattedMsg = err;
  } else {
    formattedMsg = exceptionMsg;
  }

  // Convert to string safely
  const str = String(formattedMsg);
  let end = str.length;

  // Trim trailing '.', '!', and '?' from the end without regex overhead
  while (
    end > 0 &&
    (str[end - 1] === '.' || str[end - 1] === '!' || str[end - 1] === '?')
  ) {
    end--;
  }

  // Slice the cleaned string and append the single definitive exclamation mark
  return str.slice(0, end) + '!';
}

/**
 * Hides most of a phone number while leaving the last digits, which is how
 * users recognize their own: `+447700900123` -> `+44******0123`.
 */
export function maskPhoneNumber(phoneNumber: string): string {
  const trimmed = phoneNumber.trim();
  if (trimmed.length <= 6) return '***';

  const prefix = trimmed.startsWith('+')
    ? trimmed.slice(0, 3)
    : trimmed.slice(0, 2);
  const suffix = trimmed.slice(-4);

  return `${prefix}${'*'.repeat(Math.max(3, trimmed.length - prefix.length - 4))}${suffix}`;
}

/**
 * Trims, LOWER-CASES and de-duplicates a string array, preserving order.
 *
 * A `@Transform`, so it runs BEFORE the validators — the same placement and the
 * same reason as {@link trimIfString}: `@IsIn(...)` and `@ArrayMaxSize(...)`
 * should judge the value that will actually be stored, not the one that was
 * typed.
 *
 * **The lower-casing is in the contract, not an implementation detail**, and it
 * is why this is not for every array. It suits case-INSENSITIVE identifier
 * lists — language codes, email addresses, tags. It would quietly break an array
 * of enum members: `DOCUMENT_FLAG_TYPES` are upper-case, and running them
 * through here turns every one into a value `@IsIn` rejects. Reach for it when
 * case carries no meaning, and not otherwise.
 *
 * **De-duplication makes a size cap mean what it says.** `@ArrayMaxSize(4)` over
 * `['vi','vi','vi','vi']` otherwise passes while expressing one choice, which
 * matters wherever the cap is a resource bound rather than a formatting one.
 *
 * **Order survives, and for some callers that is load-bearing** — `Set` iterates
 * in insertion order, so the first occurrence of each entry wins. `ocrLanguages`
 * is an ordered preference: naming English first on a Vietnamese document scored
 * 2.41% character error against 0.00% the other way round.
 *
 * Anything that is not an array of strings passes through untouched, so the
 * validators report the real problem rather than this quietly reshaping it.
 */
export function normalizeStringArray({ value }: { value: unknown }): unknown {
  if (!Array.isArray(value)) return value;
  if (!value.every((entry) => typeof entry === 'string')) return value;

  return [...new Set(value.map((entry) => entry.trim().toLowerCase()))];
}

/**
 * Trims a string value, leaving anything else alone for the validators to
 * reject.
 *
 * Trimming BEFORE validation is the point: without it `"  "` satisfies
 * `@MinLength(2)` and reaches the service as an empty name.
 */
export function trimIfString({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}
