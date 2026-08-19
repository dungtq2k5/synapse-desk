/**
 * @file Does the file's CONTENT match the type the client declared?
 *
 * The presign design puts the bytes on a path the server never carries: the
 * client PUTs straight to Firebase. Everything the server does control — the
 * path, the tenant, the mime allowlist, the size cap, confirm authorization,
 * read access — is enforced elsewhere. What it does not control is what is
 * inside the file. `contentType` is pinned into the signature, so a client
 * cannot upload a type it did not declare; but the client picks the
 * declaration. Declare `image/png`, upload anything.
 *
 * That matters most for attachments, which are served by signed URL to other
 * people in the same support thread, so a payload disguised as an image reaches
 * every agent who opens the ticket.
 *
 * This closes the disguised-payload case at confirm time, which is the first
 * and only moment the server can see the bytes.
 *
 * Deliberately NOT a dependency. The allowlist is six types and fixed by
 * `PURPOSE_POLICY`; a general-purpose sniffer would bring hundreds of formats
 * this system will never accept, and the interesting logic here is the text
 * case, which no signature library can answer anyway.
 */

import type { MimeType } from '@synapsedesk/common';

// `as const satisfies` and not a plain annotation: `as const` keeps the
// literals so `MATCHERS` below is checked for totality, and `satisfies` holds
// every member to {@link MimeType}. Add one here and `MATCHERS` stops compiling
// until it knows how to recognise it.
/** Every content type a storage purpose may declare. */
export const VALIDATED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  // Analytics exports. Text with no signature of their own, so
  // both fall to `looksLikeText` below — which is the honest check: neither
  // format has a magic number, and inventing one ("starts with a comma"?)
  // would reject legitimate files while catching nothing.
  'text/csv',
  'application/json',
] as const satisfies readonly MimeType[];

export type ValidatedMimeType = (typeof VALIDATED_MIME_TYPES)[number];

/** How many bytes `confirmUpload` needs to read. Every check below fits in this. */
export const SIGNATURE_SAMPLE_BYTES = 4096;

const startsWith = (head: Buffer, bytes: readonly number[]): boolean =>
  head.length >= bytes.length && bytes.every((b, i) => head[i] === b);

/**
 * Whether the sampled head looks like text.
 *
 * Text has no signature, so this answers the only way it can: the bytes must
 * contain no NUL — every binary format here carries one early, no real UTF-8
 * text does — and must decode as UTF-8.
 *
 * @param head - the first {@link SIGNATURE_SAMPLE_BYTES} of the upload
 */
function looksLikeText(head: Buffer): boolean {
  if (head.includes(0)) return false;

  // `fatal` makes an invalid sequence throw rather than yield U+FFFD.
  //
  // `stream: true` matters: this is the FIRST 4KB of a possibly larger file, so
  // the sample can end mid-character. Without it a perfectly valid UTF-8 file
  // whose 4096-byte boundary splits a multi-byte character would be rejected.
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head, { stream: true });
    return true;
  } catch {
    return false;
  }
}

const MATCHERS: Record<ValidatedMimeType, (head: Buffer) => boolean> = {
  // \x89 P N G \r \n \x1a \n — the trailing bytes catch transfers that
  // corrupted line endings, which is what they were chosen for.
  'image/png': (head) =>
    startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),

  // SOI + the first marker. JPEG has several valid fourth bytes (JFIF, Exif,
  // raw) so only the invariant three are checked.
  'image/jpeg': (head) => startsWith(head, [0xff, 0xd8, 0xff]),

  // A RIFF container whose form type is WEBP. Bytes 4-7 are the length, which
  // varies, so the two ends are checked and the middle skipped.
  'image/webp': (head) =>
    head.length >= 12 &&
    head.subarray(0, 4).toString('latin1') === 'RIFF' &&
    head.subarray(8, 12).toString('latin1') === 'WEBP',

  'application/pdf': (head) => startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d]),

  // OLE2 Compound File — the container Word 97-2003 writes. Shared with legacy
  // `.xls` and `.ppt`, which this check cannot tell apart; the allowlist is
  // what keeps those out, and this stops a PNG renamed to `.doc`.
  'application/msword': (head) =>
    startsWith(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),

  // OOXML is a ZIP, so this is `PK\x03\x04` and nothing narrower is possible
  // from a 4KB head: `.docx`, `.xlsx` and a plain `.zip` are byte-identical
  // here. Distinguishing them means reading the archive's `[Content_Types].xml`,
  // which is a parse rather than a signature check — the allowlist bounds the
  // set, and this rejects the renamed-binary case it is meant to.
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': (
    head,
  ) => startsWith(head, [0x50, 0x4b, 0x03, 0x04]),

  'text/plain': looksLikeText,
  'text/markdown': looksLikeText,
  // Same treatment, same reason: a NUL byte or an invalid UTF-8 sequence is
  // the only thing that distinguishes these from a binary payload wearing a
  // text content-type, and it is enough to reject one.
  'text/csv': looksLikeText,
  'application/json': looksLikeText,
};

function isValidatedMimeType(value: string): value is ValidatedMimeType {
  return (VALIDATED_MIME_TYPES as readonly string[]).includes(value);
}

/**
 * @param head the first `SIGNATURE_SAMPLE_BYTES` of the stored object
 * @param declaredContentType what the object claims to be
 *
 * Unknown types are REJECTED rather than waved through. Nothing outside the
 * allowlist can reach confirm — `presignUpload` refuses it long before — so
 * this branch means the allowlist grew and this table did not, and failing
 * closed is the answer that surfaces that rather than hiding it.
 */
export function matchesDeclaredType(
  head: Buffer,
  declaredContentType: string,
): boolean {
  // `image/png; charset=binary` is the same type as `image/png`; GCS echoes
  // back whatever parameters were sent.
  const mime = declaredContentType.split(';')[0].trim().toLowerCase();

  return isValidatedMimeType(mime) ? MATCHERS[mime](head) : false;
}
