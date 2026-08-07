import { PDFDocument, StandardFonts } from 'pdf-lib';

/**
 * A REAL multi-page PDF, generated rather than committed.
 *
 * Generated because the property under test is page ATTRIBUTION — "page 4"
 * has to come from the document's own structure — and a committed binary
 * fixture makes that impossible to read in a review: nobody can tell what page
 * 4 is supposed to say by looking at the diff. Here the content of each page is
 * a line of code beside the assertion.
 *
 * `pdf-lib` is a devDependency for exactly this. The parser under test is
 * `pdf-parse-fork`, so the fixture is written by one library and read by
 * another — which is the point, since a round trip through a single library
 * could agree with itself about a layout no real PDF uses.
 */
export async function buildPdf(
  pages: string[],
  {
    repeat = 40,
    /**
     * `true` writes a cross-reference STREAM — the PDF 1.5+ layout that Word,
     * Acrobat and browser print-to-PDF all emit, and so the one most customer
     * uploads actually use. Defaulted ON now that the parser handles it.
     */
    useObjectStreams = true,
  }: { repeat?: number; useObjectStreams?: boolean } = {},
): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  for (const text of pages) {
    const page = pdf.addPage([612, 792]);

    // Repeated so each page clears MIN_CHUNK_TOKENS. A page that produced a
    // sub-minimum chunk would be dropped by the chunker, and the test would
    // then be asserting about a page number that legitimately does not exist.
    const lines = Array.from({ length: repeat }, () => text);

    lines.forEach((line, index) => {
      page.drawText(line, {
        x: 40,
        y: 750 - index * 16,
        size: 11,
        font,
      });
    });
  }

  // This used to be pinned to `false` — a classic xref TABLE — because the
  // fixture parsed in file order and failed on identical bytes in isolation.
  // The cause was never the layout: `document-parser.service.ts` was handing
  // the 2018 pdf.js a Node `Buffer`, which it misreads. Pinning the layout only
  // moved the timing, and cost the suite any coverage of the format most real
  // uploads use.
  //
  // Now that the parser passes a `Uint8Array`, the default is the REAL-WORLD
  // layout, and `parse-boundaries.spec.ts` asserts both.
  return Buffer.from(await pdf.save({ useObjectStreams }));
}
