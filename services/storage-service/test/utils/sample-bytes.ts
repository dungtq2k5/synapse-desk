/**
 * Genuine file headers, one per allowlisted type.
 *
 * `confirmUpload` reads the first bytes of an uploaded object and checks them
 * against the declared `contentType`, so a test that uploads the string
 * `'x'` as `image/png` is now correctly rejected. These are the smallest inputs
 * that are honestly what they claim to be.
 *
 * Real signatures rather than hand-waved ones on purpose: a fixture that only
 * satisfies the matcher because the matcher is lenient would make the matcher
 * untestable by construction.
 */

/** An 8-byte PNG signature followed by a minimal IHDR chunk header. */
export const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52,
]);

/** SOI + APP0/JFIF, the header every ordinary JPEG opens with. */
export const JPEG_BYTES = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00,
]);

/** A RIFF container declaring the WEBP form type. Bytes 4-7 are the length. */
export const WEBP_BYTES = Buffer.concat([
  Buffer.from('RIFF', 'latin1'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBPVP8 ', 'latin1'),
]);

export const PDF_BYTES = Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1');

export const TEXT_BYTES = Buffer.from('a plain text attachment\n', 'utf8');

/**
 * Content that is NOT what it will claim to be.
 *
 * A PNG, used in tests that declare `text/plain` — the disguised-payload case
 * What this exists to catch, and the direction that matters: binary hiding behind a
 * type a human would open without thinking.
 */
export const DISGUISED_BYTES = PNG_BYTES;

/** The right bytes for a declared type, for tests that just need a valid upload. */
export function bytesFor(contentType: string): Buffer {
  switch (contentType.split(';')[0].trim()) {
    case 'image/png':
      return PNG_BYTES;
    case 'image/jpeg':
      return JPEG_BYTES;
    case 'image/webp':
      return WEBP_BYTES;
    case 'application/pdf':
      return PDF_BYTES;
    case 'text/plain':
    case 'text/markdown':
      return TEXT_BYTES;
    default:
      throw new Error(`No sample bytes for '${contentType}'`);
  }
}
