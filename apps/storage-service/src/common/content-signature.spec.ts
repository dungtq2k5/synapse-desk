import { matchesDeclaredType } from './content-signature';

/**
 * The signature table, checked against bytes rather than against itself.
 *
 * `storage-boundaries.e2e-spec` asserts every allowlisted type HAS a matcher.
 * That is a different question from whether the matcher works: an entry that
 * always answered `false` would satisfy the sweep and still reject every upload
 * of its type at confirm — after the bytes are in the bucket, which is the
 * failure the sweep exists to prevent. This file closes that half.
 */
describe('content signatures', () => {
  /**
   * An ISO-BMFF `ftyp` box, as a real HEIC begins.
   *
   * @param major the major brand
   * @param compatible the compatible-brand list, which follows the minor version
   */
  const ftyp = (major: string, compatible: string[] = []): Buffer => {
    const size = 16 + compatible.length * 4;

    return Buffer.concat([
      Buffer.from([
        (size >> 24) & 0xff,
        (size >> 16) & 0xff,
        (size >> 8) & 0xff,
        size & 0xff,
      ]),
      Buffer.from('ftyp', 'latin1'),
      Buffer.from(major, 'latin1'),
      // The minor VERSION, not a brand.
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from(compatible.join(''), 'latin1'),
    ]);
  };

  const PNG = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
  ]);
  const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0, 0, 0]);
  const XLSX =
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  describe('HEIC and HEIF', () => {
    it('accepts what an iPhone actually writes', () => {
      // Major brand `heic`, with `mif1` among the compatible brands.
      const head = ftyp('heic', ['mif1', 'heic']);

      expect(matchesDeclaredType(head, 'image/heic')).toBe(true);
      expect(matchesDeclaredType(head, 'image/heif')).toBe(true);
    });

    it('accepts a generic HEIF whose MAJOR brand is `mif1`', () => {
      expect(matchesDeclaredType(ftyp('mif1'), 'image/heif')).toBe(true);
    });

    it('accepts a brand found only in the COMPATIBLE list', () => {
      // The scan past the minor version is what this covers — a major brand
      // this table does not know, carrying a HEIF brand behind it.
      expect(matchesDeclaredType(ftyp('mp42', ['mif1']), 'image/heic')).toBe(
        true,
      );
    });

    it('**does not read the minor version as a brand**', () => {
      // The precise trap the offset-16 start defends: four bytes that spell a
      // brand, sitting where the minor version goes. Reading offset 12 would
      // let any file whose 13th-16th bytes happened to spell `mif1` through.
      const forged = Buffer.concat([
        Buffer.from([0x00, 0x00, 0x00, 0x10]),
        Buffer.from('ftyp', 'latin1'),
        Buffer.from('mp42', 'latin1'),
        Buffer.from('mif1', 'latin1'),
      ]);

      expect(matchesDeclaredType(forged, 'image/heic')).toBe(false);
    });

    it('**rejects AVIF, which wears the same container**', () => {
      // Major brand `avif`, `mif1` among its compatible brands — so the generic
      // HEIF brands alone would have accepted it. AVIF has its own media type
      // and no allowlist here includes it.
      const avif = ftyp('avif', ['mif1', 'miaf']);

      expect(matchesDeclaredType(avif, 'image/heic')).toBe(false);
      expect(matchesDeclaredType(avif, 'image/heif')).toBe(false);
    });

    it('still accepts a photo that merely MENTIONS avif', () => {
      // The other half of that rule, and the one that protects real uploads:
      // only the major brand disqualifies a file. An encoder adding `avif` to
      // the compatible list of a genuine HEIC must not bounce the photo.
      expect(
        matchesDeclaredType(ftyp('heic', ['mif1', 'avif']), 'image/heic'),
      ).toBe(true);
    });

    it('rejects a PNG renamed to `.heic` — the case it exists for', () => {
      expect(matchesDeclaredType(PNG, 'image/heic')).toBe(false);
    });

    it('rejects an ISO-BMFF container with no HEIF brand', () => {
      // `isom` is plain MP4. A video wearing an image content type.
      expect(matchesDeclaredType(ftyp('isom', ['mp42']), 'image/heic')).toBe(
        false,
      );
    });

    it('rejects a head too short to hold a brand', () => {
      expect(
        matchesDeclaredType(Buffer.from('ftyp', 'latin1'), 'image/heic'),
      ).toBe(false);
    });
  });

  describe('spreadsheets', () => {
    it('accepts the OOXML ZIP header', () => {
      expect(matchesDeclaredType(ZIP, XLSX)).toBe(true);
    });

    it('rejects a renamed binary', () => {
      expect(matchesDeclaredType(PNG, XLSX)).toBe(false);
    });
  });

  it('still rejects a type no matcher knows', () => {
    // The fail-closed branch. It is what turned this gap into a red test rather
    // than a silent acceptance, and it must keep doing that.
    expect(matchesDeclaredType(PNG, 'image/gif')).toBe(false);
  });
});
