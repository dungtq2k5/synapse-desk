import { DocumentParserService } from './document-parser.service';
import { buildPdf } from '../../../test/utils/pdf-fixture';

/**
 * The PDF path, against BOTH cross-reference layouts.
 *
 * **The regression this exists for.** `parsePdf` passed the Node `Buffer` it
 * was handed straight to `pdf-parse-fork`, whose bundled pdf.js v1.10 (2018)
 * misreads it — resolving offsets against the wrong bytes and raising
 * `FormatError: Unknown compression method in flate stream: 116, 105`, where
 * 116 and 105 are ASCII `"ti"`: document text found where a compressed stream
 * should begin. The job then failed as though the customer's upload were
 * corrupt.
 *
 * It went unnoticed for two reasons, and the second is the instructive one:
 *
 *   1. The failure is STATE-DEPENDENT. The same bytes parse on one call and
 *      fail on the next, so it read as flake rather than as a bug.
 *   2. The e2e fixture had been pinned to a classic xref TABLE to stop that
 *      flake. That looked like a fix and was actually a mask — it moved the
 *      timing, and it removed all coverage of the xref STREAM layout that Word,
 *      Acrobat and print-to-PDF emit, which is to say almost every real upload.
 *
 * So these run each layout repeatedly rather than once. A single pass proves
 * very little about an intermittent fault.
 */
describe('DocumentParserService — PDF', () => {
  const parser = new DocumentParserService();

  const parse = async (bytes: Buffer) =>
    (await parser.parse(bytes, 'pdf')).pages;

  describe.each([
    ['xref STREAM (what Word and Acrobat emit)', true],
    ['xref TABLE (the classic layout)', false],
  ])('%s', (_label, useObjectStreams) => {
    it('parses, and attributes text to the right page', async () => {
      const bytes = await buildPdf(['Alpha page', 'Beta page', 'Gamma page'], {
        useObjectStreams,
      });

      const pages = await parse(bytes);

      expect(pages).toHaveLength(3);
      expect(pages[0].markdown).toContain('Alpha page');
      expect(pages[1].markdown).toContain('Beta page');
      expect(pages[2].markdown).toContain('Gamma page');
      expect(pages.map((page) => page.pageNumber)).toEqual([1, 2, 3]);
    });

    it('**parses REPEATEDLY — the intermittent failure is the whole point**', async () => {
      // Five consecutive parses in one process. Under the Buffer path this
      // reliably failed at least once; asserting a single success would have
      // gone green against the broken code roughly half the time.
      for (let attempt = 1; attempt <= 5; attempt++) {
        const bytes = await buildPdf(['Only page'], { useObjectStreams });

        await expect(parse(bytes)).resolves.toHaveLength(1);
      }
    });
  });

  it('a single-page document is not a special case', async () => {
    // The shortest document was where the old path failed most consistently.
    const pages = await parse(await buildPdf(['Solo']));

    expect(pages).toHaveLength(1);
    expect(pages[0].markdown).toContain('Solo');
  });
});
