import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getEncoding } from 'js-tiktoken';
import { DocumentParserService } from './document-parser.service';
import { OcrService } from './ocr.service';
import { DocumentChunkerService } from './document-chunker.service';
import { buildPdf } from '../../../test/utils/pdf-fixture';
import { buildDocx } from '../../../test/utils/docx-fixture';

/**
 * The parser, on libraries rather than hand-written parsing.
 *
 * Most of these exist because the hand-written version got them WRONG, not
 * because a library upgrade might: a DOCX table became a run-on sentence, OMML
 * math vanished, `chars / 4` under-counted CJK by 3.7x, and a `#` inside a code
 * fence split a chunk in half. Each is now a property the stack has to
 * keep.
 */
describe('DocumentParserService (unit)', () => {
  const parser = new DocumentParserService(new OcrService());
  const chunker = new DocumentChunkerService();

  const parse = async (bytes: Buffer, type: string) =>
    (await parser.parse(bytes, type)).pages;

  describe('DOCX — the main reason for the change', () => {
    it('1. **a TABLE survives as a pipe table, in ONE chunk**', async () => {
      // The old converter understood headings, paragraphs, list items and
      // `<br>` and stripped the rest, so this became a run-on sentence with
      // every cell adjacent to the wrong one. **For a policy corpus the table
      // is often where the answer is** — "EMEA 500" has to stay one fact.
      const bytes = await buildDocx({
        blocks: [
          { kind: 'heading', level: 1, text: 'Expense Policy' },
          {
            kind: 'table',
            rows: [
              ['Region', 'Limit'],
              ['EMEA', '500'],
              ['APAC', '750'],
            ],
          },
        ],
      });

      const [page] = await parse(bytes, 'docx');

      // **Real GFM, with no repair pass.** The delimiter row
      // comes from `turndown-plugin-gfm`, which is what that plugin exists for.
      // The wrapper this replaced emitted no delimiter row, and ~50 lines of
      // ours put one back.
      expect(page.markdown).toContain('| Region | Limit |');
      expect(page.markdown).toContain('| --- | --- |');
      expect(page.markdown).toContain('| EMEA | 500 |');

      // And the rows are not split apart by the chunker.
      const chunks = await chunker.chunk([page]);
      const withTable = chunks.find((chunk) =>
        chunk.contentText.includes('EMEA'),
      );
      expect(withTable?.contentText).toContain('APAC');
    });

    it('2. **OMML math is DROPPED, and that is the recorded trade**', async () => {
      // The wrapper converted OMML to LaTeX and double-escaped it, so
      // `$\\frac{1}{2}$` rendered as a literal `\frac`: the math survived the
      // parse and then meant nothing. Mammoth ignores OMML entirely, so a
      // formula is ABSENT rather than wrong.
      //
      // A real trade, and small in both directions. The chunk text is
      // *embedded*, and an embedding model reads `$\frac{1}{2}$` as a string —
      // LaTeX buys no retrieval quality over `1/2` and tokenizes worse. If a
      // tenant ever needs formulas, mammoth's `transformDocument` hook is where
      // an OMML step goes.
      const bytes = await buildDocx({
        blocks: [
          { kind: 'paragraph', text: 'The rate is:' },
          { kind: 'fraction', numerator: '1', denominator: '2' },
        ],
      });

      const [page] = await parse(bytes, 'docx');

      // The surrounding prose is intact — dropping math does not drop content.
      expect(page.markdown).toContain('The rate is:');
      // And nothing broken is emitted in its place.
      expect(page.markdown).not.toContain('\\\\frac');
    });

    it('3. a DOCX has NO page number, rather than a fake page 1', async () => {
      // A citation reading "page 1" of a fifty-page Word document is
      // confidently wrong, and a user who clicks through learns not to trust
      // citations at all.
      const bytes = await buildDocx({
        blocks: [{ kind: 'paragraph', text: 'Carry-over is five days.' }],
      });

      const [page] = await parse(bytes, 'docx');

      expect(page.pageNumber).toBeNull();
    });
  });

  describe('PDF — the citation guarantee', () => {
    it.each([
      ['xref STREAM (what Word and Acrobat emit)', true],
      ['xref TABLE (the classic layout)', false],
    ])('4. %s: pageNumber is 1-based and correct per page', async (_l, uos) => {
      // Non-negotiable across a parser swap: `page_number` is what every
      // citation in the product resolves to.
      const bytes = await buildPdf(['Alpha page', 'Beta page', 'Gamma page'], {
        useObjectStreams: uos,
      });

      const pages = await parse(bytes, 'pdf');

      expect(pages.map((page) => page.pageNumber)).toEqual([1, 2, 3]);
      expect(pages[0].markdown).toContain('Alpha page');
      expect(pages[2].markdown).toContain('Gamma page');
    });

    it('5. **groups runs into LINES** rather than one long paragraph', async () => {
      // A PDF has no lines, only positioned runs, and the old parser joined
      // every run on a page with a space. That is not cosmetic: the chunker
      // splits on paragraph and line boundaries, so a page with neither fell
      // straight through to a hard character cut and every chunk began
      // mid-sentence.
      const bytes = await buildPdf(['First line here'], { repeat: 6 });

      const [page] = await parse(bytes, 'pdf');

      expect(page.markdown.split('\n').length).toBeGreaterThan(1);
    });

    it('6. parses repeatedly — the intermittent failure that started this', async () => {
      // `pdf-parse-fork` misread a Node `Buffer`, resolving offsets against
      // the wrong bytes and failing on roughly one call in two while reporting
      // the customer's file as corrupt.
      for (let attempt = 0; attempt < 5; attempt++) {
        const bytes = await buildPdf(['Only page']);

        await expect(parse(bytes, 'pdf')).resolves.toHaveLength(1);
      }
    });
  });

  describe('offline execution', () => {
    it('7. **the parser makes NO network calls**', async () => {
      // The guard against trap 2 — one of the similarly-named
      // PDF packages calls a vision API per page. That failure is silent
      // because it produces BETTER output: nothing looks wrong, and every page
      // has quietly been sent to a third party and billed for.
      const reachedTheNetwork = jest.fn(() => {
        throw new Error('the parser attempted a network call');
      });

      const fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockImplementation(reachedTheNetwork as never);

      try {
        await parse(
          await buildDocx({
            blocks: [{ kind: 'paragraph', text: 'Offline, entirely.' }],
          }),
          'docx',
        );
        await parse(await buildPdf(['Offline too']), 'pdf');
      } finally {
        fetchSpy.mockRestore();
      }

      expect(reachedTheNetwork).not.toHaveBeenCalled();
    });
  });

  describe('log noise', () => {
    it('7b. **parsing a normal PDF emits no pdf.js warning**', async () => {
      // pdf.js logged `UnknownErrorException: Ensure that the
      // standardFontDataUrl API parameter is provided` once per document, on
      // the busiest path in this service.
      //
      // Harmless on its own, and that is exactly why it is worth removing:
      // noise nobody asserts on is noise nobody removes, and a hot path that
      // always prints a warning is one where a real warning goes unread.
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

      try {
        await parse(await buildPdf(['A normal page of text']), 'pdf');
      } finally {
        warn.mockRestore();
      }

      const messages = warn.mock.calls.flat().join(' ');
      expect(messages).not.toContain('standardFontDataUrl');
    });
  });

  describe('the repair layer is GONE', () => {
    it('8. **`repairOfficeMarkdown` no longer exists**', async () => {
      // Deleting code is the deliverable, so assert it stayed deleted. The
      // helper existed only to undo damage a wrapper did to turndown's output;
      // calling turndown directly removes both the damage and the repair.
      const parserModule: Record<string, unknown> =
        await import('./document-parser.service');

      expect(parserModule.repairOfficeMarkdown).toBeUndefined();
      expect(Object.keys(parserModule)).toEqual(['DocumentParserService']);
    });

    it('9. the wrapper package is no longer a dependency', () => {
      // Read rather than imported: `resolveJsonModule` is off, and turning it
      // on for one assertion would change how every module in the service
      // resolves.
      const manifest = JSON.parse(
        readFileSync(join(__dirname, '../../../package.json'), 'utf8'),
      ) as { dependencies?: Record<string, string> };

      expect(manifest.dependencies).not.toHaveProperty(
        '@aidalinfo/office-to-markdown',
      );
      // And the two it wrapped are now DIRECT, rather than reached through it.
      expect(manifest.dependencies).toHaveProperty('mammoth');
      expect(manifest.dependencies).toHaveProperty('turndown');
      // Here rather than in a new test because this assertion exists to
      // describe what the PARSER depends on, and leaving it at two of three
      // makes it quietly stop doing that.
      expect(manifest.dependencies).toHaveProperty('exceljs');
    });
  });

  describe('token counting', () => {
    it('10. **js-tiktoken differs from chars/4 on CJK and code**', () => {
      // Proves the new counter is actually engaged rather than an unused
      // dependency. The direction matters: `chars / 4` UNDER-counts CJK, so a
      // chunk sized by characters silently overflowed the embedding model's
      // input on exactly the documents least likely to be spot-checked.
      const encoder = getEncoding('cl100k_base');

      const cjk = '这是一个中文句子，用于测试分词器的准确性。';
      const code =
        'const x = items.filter((i)=>i.id!==null).map((i)=>i.value);';

      expect(encoder.encode(cjk).length).toBeGreaterThan(
        Math.ceil(cjk.length / 4),
      );
      expect(encoder.encode(code)).not.toHaveLength(Math.ceil(code.length / 4));
    });
  });

  describe('bounded time on pathological input', () => {
    it('11. **`"<a".repeat(100_000)` parses without blowing up**', async () => {
      // Carried over deliberately. The deleted `stripHtmlTags` recorded a
      // measured 0.9s for 80KB with quadratic growth; deleting that code must
      // not delete the test proving the class of bug is gone. The library is
      // not automatically immune.
      const hostile = Buffer.from('<a'.repeat(100_000), 'utf8');

      const started = Date.now();
      await parse(hostile, 'txt');

      expect(Date.now() - started).toBeLessThan(2_000);
    });

    it('12. a hostile TABLE run parses in bounded time', async () => {
      // Retargeted from the deleted repair layer onto the path that now
      // handles it. turndown is not automatically immune to a pathological
      // document either, and this is the class of bug worth keeping a guard on.
      const rows = Array.from({ length: 400 }, (_, index) => [
        `cell-${index}`,
        'x'.repeat(40),
      ]);

      const bytes = await buildDocx({ blocks: [{ kind: 'table', rows }] });

      const started = Date.now();
      await parse(bytes, 'docx');

      expect(Date.now() - started).toBeLessThan(5_000);
    });
  });
});
