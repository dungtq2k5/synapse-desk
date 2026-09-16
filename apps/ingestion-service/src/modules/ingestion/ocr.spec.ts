import { DocumentParserService } from './document-parser.service';
import { parseOcrLanguages } from '@synapsedesk/common';
import { OcrService } from './ocr.service';
import {
  buildMixedPdf,
  buildPdf,
  buildScannedPdf,
  buildStampedPdf,
} from '../../../test/utils/pdf-fixture';
import {
  HAS_OCR_BINARIES,
  HAS_POPPLER,
  HAS_TESSERACT,
  OCR_SKIP_REASON,
  describeWithOcr,
  itWithPoppler,
} from '../../../test/utils/ocr-binaries';

/**
 * Scanned-page OCR
 *
 * **These tests need binaries on the HOST**, and the Docker target does not
 * provide them: jest runs on the developer's machine. Install with
 *
 *     sudo apt-get install -y poppler-utils tesseract-ocr tesseract-ocr-eng
 *
 * `apps/ingestion-service/README.md` says the same thing at more length,
 * including how to add languages beyond English.
 *
 * and the suites below stop skipping. They SKIP rather than fail on purpose —
 * a red suite nobody can fix locally gets deleted, a visibly skipped one gets
 * the package installed.
 */
describe('Scanned PDFs', () => {
  const parser = new DocumentParserService(new OcrService());

  const parse = async (bytes: Buffer) =>
    (await parser.parse(bytes, 'pdf')).pages;

  it('reports which binaries this machine has, and the skip gate agrees', () => {
    // The line a developer reading a skipped suite needs, so they learn which
    // half is missing without running `which`.
    console.log(
      `[ocr] poppler: ${HAS_POPPLER ? 'present' : 'ABSENT'}` +
        `, tesseract: ${HAS_TESSERACT ? 'present' : 'ABSENT'}` +
        `${HAS_OCR_BINARIES ? '' : ` — ${OCR_SKIP_REASON}`}`,
    );

    // **And the assertion, which is about the GATE rather than the machine.**
    // `describeWithOcr` decides whether every suite below runs, and it is a
    // separate export from the flags printed above. Nothing else couples them,
    // so they can disagree in both directions and each is quietly wrong: a gate
    // that skips while the report says "present" sends somebody to install a
    // package they already have, and one that RUNS while the report says
    // "absent" turns a missing binary into a red suite whose own output denies
    // the cause.
    //
    // Written against the real machine either way — with the binaries this
    // asserts the suites run, without them it asserts they skip — so it is a
    // check on both hosts rather than only the equipped one.
    expect(HAS_OCR_BINARIES).toBe(HAS_POPPLER && HAS_TESSERACT);
    expect(describeWithOcr === describe).toBe(HAS_OCR_BINARIES);
  });

  describeWithOcr('the pages pdfjs cannot read', () => {
    it('**a fully scanned PDF yields text instead of nothing**', async () => {
      // and the behaviour it replaces is worth naming: this page
      // used to come back as an empty list, because `parsePdf` ended in
      // `pages.filter((page) => page.markdown.trim().length > 0)`. The
      // document then produced no chunks and failed as `NoExtractableText` —
      // the cheap half of scanned-PDF handling, which this replaces.
      const pages = await parse(await buildScannedPdf(['SCANNED APPENDIX']));

      expect(pages).toHaveLength(1);
      expect(pages[0].markdown).toMatch(/SCANNED/i);
      expect(pages[0].source).toBe('ocr');
    }, 120_000);

    it('4. **page numbers survive OCR**, which is what citations resolve to', async () => {
      // Rasterization is per page, so the number is carried rather
      // than inferred — and OCR'd pages are appended as they complete, so the
      // list is sorted before it leaves the parser. A citation resolving to
      // "page 4" from a list where 4 followed 7 would be confidently wrong.
      const pages = await parse(
        await buildMixedPdf([
          'Born digital page one',
          { scanned: 'SCANNED TWO' },
          'Born digital page three',
          { scanned: 'SCANNED FOUR' },
        ]),
      );

      expect(pages.map((page) => page.pageNumber)).toEqual([1, 2, 3, 4]);
      expect(pages.map((page) => page.source)).toEqual([
        'text',
        'ocr',
        'text',
        'ocr',
      ]);
    }, 180_000);

    it('and the parser reports how many pages the document HAS', async () => {
      // `pages.length` stops being the page count once anything can be
      // dropped, and the page-count check needs the real number to compare against.
      const parsed = await parser.parse(
        await buildMixedPdf(['Born digital', { scanned: 'SCANNED' }]),
        'pdf',
      );

      expect(parsed.pageCount).toBe(2);
      expect(parsed.failedPages).toEqual([]);
    }, 120_000);
  });

  describeWithOcr('text pages and image pages both yield text', () => {
    it('**a mixed PDF returns all three pages, with page numbers intact**', async () => {
      const pages = await parse(
        await buildMixedPdf([
          'Born digital page one',
          { scanned: 'SCANNED APPENDIX' },
          'Born digital page three',
        ]),
      );

      expect(pages.map((page) => page.pageNumber)).toEqual([1, 2, 3]);
      expect(pages[1].markdown).toMatch(/SCANNED/i);
    }, 120_000);
  });
});

/**
 * The pipeline's own properties.
 *
 * These are SPY-based, so no tesseract, and running them everywhere is
 * fortunate: they are the ones guarding cost and the offline property, and a
 * machine without tesseract is exactly where a regression in them would go
 * unnoticed.
 *
 * **Three of them still need poppler, for the FIXTURE rather than the code** —
 * `buildStampedPdf`, `buildMixedPdf` and `buildScannedPdf` rasterise through
 * `pdftoppm`. Unguarded they failed with `spawnSync pdftoppm ENOENT` on every
 * host without it, CI included, which is the outcome `ocr-binaries.ts` exists
 * to prevent and states it prevents. `itWithPoppler` skips those three and
 * leaves the rest running, because `describe.skip` would take the two that
 * hold on any machine with them.
 */
describe('The OCR pipeline', () => {
  const ocr = new OcrService();

  itWithPoppler(
    '1. **a watermark-only text layer is OCR’d, not kept**',
    async () => {
      // in the case that motivates the threshold. `trim().length > 0` was
      // the wrong test: this page has 21 characters of scanner stamp and is an
      // image. The floor is 32, measured — see `MIN_PAGE_CHARACTERS`.
      const parser = new DocumentParserService(ocr);
      const spy = jest.spyOn(ocr, 'recognisePage');
      spy.mockResolvedValue({ ok: true, text: 'the recognized body text' });

      const stamped = await buildStampedPdf('Scanned by CamScanner');
      const parsed = await parser.parse(stamped, 'pdf');

      expect(spy).toHaveBeenCalledTimes(1);
      expect(parsed.pages[0].source).toBe('ocr');
      expect(parsed.pages[0].markdown).toBe('the recognized body text');

      spy.mockRestore();
    },
    120_000,
  );

  it('3. **a born-digital PDF invokes no OCR at all**', async () => {
    // OCR on the common path is pure cost, and this is the test
    // that keeps it off.
    const parser = new DocumentParserService(ocr);
    const spy = jest.spyOn(ocr, 'recognisePage');

    await parser.parse(await buildPdf(['An ordinary page of text']), 'pdf');

    expect(spy).not.toHaveBeenCalled();

    spy.mockRestore();
  }, 60_000);

  itWithPoppler(
    '2. **a page that times out fails that PAGE, not the document**',
    async () => {
      // The blast radius decision, pinned. One pathological image must not cost
      // the other 199 pages.
      const parser = new DocumentParserService(ocr);
      const spy = jest.spyOn(ocr, 'recognisePage');
      spy.mockResolvedValue({ ok: false, reason: 'timeout' });

      const parsed = await parser.parse(
        await buildMixedPdf([
          'Born digital page one',
          { scanned: 'UNREADABLE' },
        ]),
        'pdf',
      );

      // The good page survives, the bad one is RECORDED rather than dropped —
      // and it carries the reason it was mocked with, not a generic one.
      expect(parsed.pages.map((page) => page.pageNumber)).toEqual([1]);
      expect(parsed.failedPages).toEqual([
        { pageNumber: 2, reason: 'timeout' },
      ]);
      expect(parsed.pageCount).toBe(2);

      spy.mockRestore();
    },
    120_000,
  );

  itWithPoppler(
    '**the tenant’s PDF is never written to disk**',
    async () => {
      // The property the offline claim rests on. Both tools take stdin and give
      // stdout, so nothing lands: "documents never leave the deployment" reads as
      // an empty promise if the same document is sitting in /tmp while it is read.
      //
      // **Asserted against the FILESYSTEM, not against an `fs` spy.** A spy would
      // only catch this process; `pdftoppm` and `tesseract` are separate
      // processes that could write their own temp files, and a mock of
      // `fs.writeFile` would never see them. Pointing TMPDIR at an empty
      // directory catches every route to disk that respects it — ours and
      // theirs.
      const { mkdtemp, readdir, rm } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');

      const watched = await mkdtemp(join(tmpdir(), 'ocr-nodisk-'));
      const previous = process.env.TMPDIR;
      process.env.TMPDIR = watched;

      try {
        await new DocumentParserService(ocr).parse(
          await buildScannedPdf(['SCANNED APPENDIX']),
          'pdf',
        );

        expect(await readdir(watched)).toEqual([]);
      } finally {
        if (previous === undefined) delete process.env.TMPDIR;
        else process.env.TMPDIR = previous;
        await rm(watched, { recursive: true, force: true });
      }
    },
    120_000,
  );

  it('4. a language code with shell metacharacters is REFUSED, not dropped', () => {
    // `spawn` without a shell is the guarantee; this asserts it rather than
    // assuming it. If this ever ran through a shell, the `;` would execute.
    //
    // The refusal moved to `parseOcrLanguages`, and moved for a reason:
    // `languageArgument` used to take `string[]` and map through the table
    // with a cast, so a hostile code fell out of `-l` and the document was
    // OCR'd in English with nothing reporting it. Falling back is the right
    // answer to "no languages given" and the wrong one to "this code is not a
    // language" — the two look identical once the code has been dropped.
    expect(() => parseOcrLanguages(['eng; touch /tmp/pwned'])).toThrow(
      'eng; touch /tmp/pwned',
    );

    // Which leaves `languageArgument` with a total mapping over a type that
    // cannot carry an unknown code, and one genuine fallback.
    expect(ocr.languageArgument(['vi', 'en'])).toBe('vie+eng');
    expect(ocr.languageArgument([])).toBe('eng');
  });

  it('and the language order is preserved, because order is what costs accuracy', () => {
    // Measured: naming English first on a Vietnamese document scored 2.41%
    // character error against 0.00% the other way round.
    expect(ocr.languageArgument(['vi', 'en'])).toBe('vie+eng');
    expect(ocr.languageArgument(['en', 'vi'])).toBe('eng+vie');
  });
});

/**
 * — a missing binary is run-open, not boot-closed.
 *
 * Argued the opposite for the injection classifier and both are
 * right, which is why the difference is asserted rather than assumed. That was
 * a SECURITY control: absent, it silently stops defending, so the process must
 * not start without it. This is a CAPABILITY: absent, PDFs needing OCR fail
 * with a named reason and every other document still ingests. Failing the boot
 * would take ingestion down for every tenant because a minority feature is
 * unavailable.
 */
describe('When the binaries are missing', () => {
  it('**the document fails with a NAMED reason, and nothing throws at construction**', async () => {
    const ocr = new OcrService();
    // Construction is unconditional — no probe, no throw. That is the
    // boot-open half.
    jest.spyOn(ocr, 'checkAvailability').mockResolvedValue(false);

    const result = await ocr.recognisePage(Buffer.alloc(0), 1, []);

    expect(result).toEqual({ ok: false, reason: 'binary_missing' });
  });

  itWithPoppler(
    'and the page is RECORDED as failed rather than dropped',
    async () => {
      // Which is what makes the failure visible: the page-count check reports it, and the
      // Knowledge Manager sees "page 2 could not be indexed" instead of a
      // document that is quietly one page short.
      //
      // **Gated on poppler even though it is the missing-binary test**, which
      // reads backwards until you see which binary is which: availability is
      // MOCKED false, so tesseract is not needed — but the mixed-page fixture is
      // rasterised for real, so poppler is. A machine lacking it used to fail
      // this test with the very error the test is about, one layer down.
      const ocr = new OcrService();
      jest.spyOn(ocr, 'checkAvailability').mockResolvedValue(false);

      const parsed = await new DocumentParserService(ocr).parse(
        await buildMixedPdf([
          'Born digital page one',
          { scanned: 'UNREADABLE' },
        ]),
        'pdf',
      );

      expect(parsed.pages.map((page) => page.pageNumber)).toEqual([1]);
      expect(parsed.failedPages).toEqual([
        { pageNumber: 2, reason: 'binary_missing' },
      ]);
      expect(parsed.pageCount).toBe(2);
    },
    120_000,
  );
});
