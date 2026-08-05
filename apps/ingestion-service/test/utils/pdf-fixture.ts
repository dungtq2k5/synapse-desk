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
  { repeat = 40 }: { repeat?: number } = {},
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

  return Buffer.from(await pdf.save());
}
