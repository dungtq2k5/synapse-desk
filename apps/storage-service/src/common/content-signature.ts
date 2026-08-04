/**
 * Does the file's CONTENT match the type the client declared?
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

/**
 * Every type any purpose may declare. Kept as a literal union so the matcher
 * table below is TOTAL: adding a type to a `mimeAllowlist` without teaching it
 * how to be recognised is a compile error, not a silently unchecked upload.
 */
export const VALIDATED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/markdown',
] as const;

export type ValidatedMimeType = (typeof VALIDATED_MIME_TYPES)[number];

/** How many bytes `confirmUpload` needs to read. Every check below fits in this. */
export const SIGNATURE_SAMPLE_BYTES = 4096;

const startsWith = (head: Buffer, bytes: readonly number[]): boolean =>
  head.length >= bytes.length && bytes.every((b, i) => head[i] === b);

/**
 * A text file has no signature, so "is this really text?" is answered the only
 * way it can be: it must not be something else, and it must decode.
 *
 * A NUL byte is the discriminator that matters. Every binary format this system
 * accepts carries one within the first few bytes, and no legitimate UTF-8 text
 * file contains one — so this rejects a PNG or a PDF renamed to `.txt` while
 * accepting any real document, in any language.
 *
 * The decode check catches the rest: arbitrary binary that happens to avoid NUL
 * is still overwhelmingly likely to contain an invalid UTF-8 sequence.
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

  'text/plain': looksLikeText,
  'text/markdown': looksLikeText,
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
