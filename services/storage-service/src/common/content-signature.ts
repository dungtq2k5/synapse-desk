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

import type {
  AllowedAttachmentMimeType,
  AllowedDocumentMimeType,
  AvatarMimeType,
  ExportMimeType,
} from '@synapsedesk/common';

/**
 * Every content type a storage purpose may declare — DERIVED from the four
 * allowlists rather than restated.
 *
 * **This was a hand-written array, and that is exactly how it went wrong.** The
 * comment above it claimed "add one here and `MATCHERS` stops compiling until it
 * knows how to recognise it" — true, but it guarded the wrong edge. Nothing tied
 * it to `PURPOSE_POLICY`, so widening an allowlist in `libs/` left it behind,
 * and `matchesDeclaredType` fails closed: `image/heic` was accepted at presign
 * and rejected at confirm, once the bytes were already in the bucket.
 *
 * A union of the allowlists closes that. Add a type to any of the four and
 * `MATCHERS` stops compiling until it is recognized — the guarantee the old
 * comment described, now attached to the edge that actually moves.
 *
 * **A type and no array**, because nothing needs the members at run time.
 * `MATCHERS` is keyed by this union and is therefore the same set, so
 * {@link isValidatedMimeType} asks IT — one source instead of a list and a
 * table that can disagree.
 */
export type ValidatedMimeType =
  | AvatarMimeType
  | AllowedAttachmentMimeType
  | AllowedDocumentMimeType
  | ExportMimeType;

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

/**
 * The `ftyp` brands an ISO-BMFF still image may declare.
 *
 * One set for both media types, because the file format does not separate them
 * the way the MIME types do: an iPhone `.heic` declares major brand `heic` and
 * lists `mif1` among its compatible brands, so a check that demanded `heic` for
 * `image/heic` and `mif1` for `image/heif` would reject real files of both.
 */
const HEIF_BRANDS = new Set([
  // HEVC-coded stills, and the multi-image containers holding them.
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'hevm',
  'hevs',
  // The generic HEIF image and image-sequence brands. `image/heif` IS `mif1`,
  // and a real `.heic` lists it among its compatible brands, so it cannot be
  // dropped to gain precision — see `EXCLUDED_MAJOR_BRANDS` for what that costs
  // and how the cost is paid.
  'mif1',
  'mif2',
  'msf1',
]);

/**
 * Formats that share the HEIF container but are NOT what was declared.
 *
 * AVIF is the case this exists for. It is ISO-BMFF and lists `mif1` among its
 * compatible brands, so the generic brands above would accept it as
 * `image/heic` — and AVIF has its own media type, which no allowlist here
 * includes. A file declaring `image/heic` while being AVIF is misdeclared
 * whichever way it is read.
 *
 * **Matched on the MAJOR brand only, and that is the point.** Refusing any file
 * that merely mentions `avif` in its compatible list would start rejecting real
 * photographs the moment an encoder adds it, and a bounced customer photo costs
 * more here than an AVIF stored under the wrong image type. The major brand is
 * the file's own statement of what it is.
 */
const EXCLUDED_MAJOR_BRANDS = new Set(['avif', 'avis']);

/**
 * Whether the head is an ISO-BMFF file whose `ftyp` box names a HEIF brand.
 *
 * **Cannot tell `image/heic` from `image/heif`**, for the same reason the OOXML
 * matcher below cannot tell `.docx` from `.xlsx`: the distinction is not in the
 * signature. Real files interleave the brands — an iPhone `.heic` carries
 * `mif1` too — so separating them would reject genuine photographs to buy a
 * precision the format does not offer. The allowlist bounds the set; this
 * rejects the renamed-binary case it exists for.
 *
 * It DOES refuse {@link EXCLUDED_MAJOR_BRANDS}, which is a different question:
 * not "which of the two is it" but "is it a third format wearing their
 * container".
 */
function isHeifFamily(head: Buffer): boolean {
  // A 4-byte big-endian box size, then the box type. `ftyp` MUST be the first
  // box, which is what makes this a signature check rather than a search.
  if (head.length < 12 || head.subarray(4, 8).toString('latin1') !== 'ftyp') {
    return false;
  }

  const major = head.subarray(8, 12).toString('latin1');
  if (EXCLUDED_MAJOR_BRANDS.has(major)) return false;
  if (HEIF_BRANDS.has(major)) return true;

  // Compatible brands run from 16 to the end of the box. Offset 12 is skipped
  // deliberately — it is the minor VERSION, and reading it as a brand would let
  // four arbitrary bytes satisfy the check.
  //
  // Sizes 0 and 1 are ISO-BMFF's "extends to EOF" and "64-bit size follows", so
  // anything under a plausible box is treated as "scan what was sampled".
  const declared = head.readUInt32BE(0);
  const end = Math.min(declared >= 16 ? declared : head.length, head.length);

  for (let offset = 16; offset + 4 <= end; offset += 4) {
    if (HEIF_BRANDS.has(head.subarray(offset, offset + 4).toString('latin1'))) {
      return true;
    }
  }

  return false;
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

  'image/heic': isHeifFamily,
  'image/heif': isHeifFamily,

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

  // The same ZIP header, and deliberately the same check — see above.
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': (head) =>
    startsWith(head, [0x50, 0x4b, 0x03, 0x04]),

  'text/plain': looksLikeText,
  'text/markdown': looksLikeText,
  // Same treatment, same reason: a NUL byte or an invalid UTF-8 sequence is
  // the only thing that distinguishes these from a binary payload wearing a
  // text content-type, and it is enough to reject one.
  'text/csv': looksLikeText,
  'application/json': looksLikeText,
};

/**
 * Whether this service can check a type's content at all.
 *
 * Asks `MATCHERS` rather than a parallel list, so "is it allowed" and "can it be
 * verified" cannot answer differently. Exported for the boundary sweep, which
 * asserts the same property across `PURPOSE_POLICY` through the real predicate.
 */
export function isValidatedMimeType(value: string): value is ValidatedMimeType {
  return Object.hasOwn(MATCHERS, value);
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
