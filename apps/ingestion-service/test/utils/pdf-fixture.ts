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
 * `pdfjs-dist`, so the fixture is written by one library and read by
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

/**
 * A PDF whose pages are IMAGES — the input the whole OCR feature exists for.
 *
 * **Generated, not committed**, for the same reason `buildPdf` is: a binary
 * blob in git makes it impossible to tell from a diff what page 2 is supposed
 * to say, and page attribution is exactly what these tests assert.
 *
 * The route adds no dependency: `pdf-lib` draws text but
 * cannot rasterise it, so the text is drawn into a PDF, `pdftoppm` renders that
 * page to a PNG, and `embedPng` puts the PNG back into a document as a
 * full-bleed image. pdfjs then extracts **zero** text items from it — verified,
 * not assumed — which is precisely the page `parsePdf` silently drops today.
 *
 * **Requires poppler on the host**. Callers guard with
 * `describeWithPoppler`; this throws rather than returning a broken fixture,
 * because a test that silently received a text page would pass for the wrong
 * reason.
 *
 * The rendering DPI is deliberately not 300: the fixture only has to be legible
 * to tesseract, and 150 halves the bytes flowing through the pipe in every test
 * that builds one. Production uses 300 (§3.3), and that difference is a fixture
 * detail rather than a disagreement.
 */
export async function buildScannedPdf(
  pages: string[],
  { size = 44 }: { size?: number } = {},
): Promise<Buffer> {
  // **`execFileSync`, and the `Sync` is load-bearing.** The async `execFile`
  // has no `input` option — that belongs to the sync form — so passing one
  // spawns `pdftoppm` against a stdin nothing ever writes or closes, and the
  // fixture hangs forever instead of failing. A fixture builder may block; the
  // production path (§3.1) writes to `child.stdin` explicitly.
  const { execFileSync } = await import('node:child_process');

  const out = await PDFDocument.create();

  for (const text of pages) {
    // 1. A one-page PDF carrying the words, drawn large so a 150-dpi render
    //    stays comfortably legible.
    const source = await PDFDocument.create();
    const font = await source.embedFont(StandardFonts.Helvetica);
    const page = source.addPage([612, 792]);
    page.drawText(text, { x: 50, y: 600, size, font });

    // 2. Rasterised through poppler — stdin to stdout, no temp file, which is
    //    the same pipe route §3.1 chooses for production.
    const rendered = execFileSync(
      'pdftoppm',
      ['-f', '1', '-l', '1', '-r', '150', '-png', '-'],
      { input: Buffer.from(await source.save()), maxBuffer: 64 * 1024 * 1024 },
    );

    // 3. Back into a PDF as an image, filling the page.
    const png = await out.embedPng(rendered);
    const imagePage = out.addPage([612, 792]);
    imagePage.drawImage(png, { x: 0, y: 0, width: 612, height: 792 });
  }

  return Buffer.from(await out.save());
}

/**
 * Text and image pages interleaved — the mixed document this is about.
 *
 * `pages` marks each one: a string is drawn as text, a `{ scanned }` entry is
 * rasterised. Interleaving matters because page NUMBERS are the property under
 * test, and a fixture with all its images at the end would pass even if the
 * OCR'd pages were appended rather than kept in place.
 */
export async function buildMixedPdf(
  pages: (string | { scanned: string })[],
): Promise<Buffer> {
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);

  for (const entry of pages) {
    if (typeof entry === 'string') {
      const page = out.addPage([612, 792]);
      // 40 repeats for the same reason `buildPdf` uses them: a page under
      // MIN_CHUNK_TOKENS is dropped by the CHUNKER, and a test asserting about
      // a page number that legitimately does not exist proves nothing.
      Array.from({ length: 40 }).forEach((_, index) => {
        page.drawText(entry, { x: 40, y: 750 - index * 16, size: 11, font });
      });
      continue;
    }

    const scanned = await PDFDocument.load(
      await buildScannedPdf([entry.scanned]),
    );
    const [copied] = await out.copyPages(scanned, [0]);
    out.addPage(copied);
  }

  return Buffer.from(await out.save());
}

/**
 * An image page carrying a small text stamp — the case §3.2's floor exists for.
 *
 * A scanner header, a page number, or a partial OCR layer leaves a handful of
 * characters on a page that is otherwise an image. `trim().length > 0` keeps
 * such a page and loses everything on it; `MIN_PAGE_CHARACTERS` is what
 * distinguishes them, and this builds the input that tells the two apart.
 */
export async function buildStampedPdf(stamp: string): Promise<Buffer> {
  const bytes = await buildScannedPdf(['THE REAL BODY TEXT OF THIS PAGE']);
  const pdf = await PDFDocument.load(bytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  // Bottom-left, small — where a scanner puts its own name.
  pdf.getPage(0).drawText(stamp, { x: 40, y: 30, size: 8, font });

  return Buffer.from(await pdf.save());
}
