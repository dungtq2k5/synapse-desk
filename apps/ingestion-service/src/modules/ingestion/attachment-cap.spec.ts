import {
  CHARACTER_TRUNCATION_MARKER,
  MAX_EXTRACTED_TEXT_CHARS,
  type ParseEligibleMimeType,
} from '@synapsedesk/common';
import { AttachmentExtractorService } from './attachment-extractor.service';
import { DocumentParserService } from './document-parser.service';
import type { ParsedDocument } from './document-parser.service';
import type { StorageReferenceService } from '../storage-client/storage-reference.service';

/**
 * The OUTER cap — where a multi-page extraction stops.
 *
 * The parser is faked, not the constant. A workbook big enough to breach
 * `MAX_EXTRACTED_TEXT_CHARS` honestly would be the slowest test in the service,
 * and mocking the constant would test a number production never uses. Returning
 * pages of a chosen size exercises the real rule against the real ceiling — the
 * same trade `ingestion-pipeline`'s chunk-ceiling tests make.
 */
describe('The per-attachment character cap (unit)', () => {
  const DOCX =
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document' satisfies ParseEligibleMimeType;

  /** Pages of `size` characters each, distinguishable by their first line. */
  const pagesOf = (count: number, size: number): ParsedDocument => ({
    contentHash: 'x',
    pageCount: 0,
    failedPages: [],
    pages: Array.from({ length: count }, (_, index) => ({
      pageNumber: index + 1,
      markdown: `## Sheet: S${index + 1}\n${'x'.repeat(size)}`,
    })),
  });

  const extractWith = async (parsed: ParsedDocument) => {
    const parser = { parse: jest.fn().mockResolvedValue(parsed) };
    const storage = {
      downloadObject: jest.fn().mockResolvedValue(Buffer.from('bytes')),
    };

    const service = new AttachmentExtractorService(
      parser as unknown as DocumentParserService,
      storage as unknown as StorageReferenceService,
    );

    return service.extract('organizations/o/m/f.docx', DOCX, 'org-1');
  };

  it('4. **stops at a PAGE boundary rather than slicing mid-table**', async () => {
    // A joined-then-sliced extraction cuts a row in half and leaves no account
    // of what is missing. Every included page is whole here, which is what makes
    // the result readable at all.
    //
    // Eleven pages at 12% of the budget: four fit, the fifth cannot.
    const size = Math.floor(MAX_EXTRACTED_TEXT_CHARS * 0.12);
    const result = await extractWith(pagesOf(11, size));

    expect(result.truncated).toBe(true);
    expect(result.markdown.length).toBeLessThanOrEqual(
      MAX_EXTRACTED_TEXT_CHARS,
    );

    // Whole pages only: the last surviving page ends with its own content, not
    // mid-run.
    const headings = result.markdown.match(/## Sheet: S\d+/g) ?? [];
    expect(headings.length).toBeGreaterThan(0);
    expect(headings.length).toBeLessThan(11);
    // Each included page kept its full body.
    for (const heading of headings) {
      const index = Number(heading.replace('## Sheet: S', ''));
      expect(result.markdown).toContain(
        `## Sheet: S${index}\n${'x'.repeat(size)}`,
      );
    }
  });

  it('5. **…and names how many sections were dropped**', async () => {
    // Absence has to be legible. A reader — the model above all — cannot tell a
    // document that ended from one that stopped, and "4 of 11" is the whole
    // difference.
    const size = Math.floor(MAX_EXTRACTED_TEXT_CHARS * 0.12);
    const result = await extractWith(pagesOf(11, size));

    const headings = result.markdown.match(/## Sheet: S\d+/g) ?? [];
    expect(result.markdown).toContain(
      `> [Truncated: ${headings.length} of 11 sections shown`,
    );
    expect(result.markdown).toContain('size limit reached');
  });

  it('**5b. and a document INSIDE the budget carries no marker**', async () => {
    // The pair for 5. Stamping unconditionally would tell the model every
    // attachment it sees is incomplete, which is worse than saying nothing.
    const result = await extractWith(pagesOf(3, 100));

    expect(result.truncated).toBe(false);
    expect(result.markdown).not.toContain('Truncated');
    expect(result.markdown).toContain('## Sheet: S3');
  });

  it('**5c. ONE page larger than the whole budget falls back to the character slice**', async () => {
    // The backstop, and the case a page-boundary rule cannot cover: stopping
    // before the first page would store nothing at all. A cut table is worse
    // than a whole one and far better than an empty column.
    //
    // This is also the `.docx` shape — one page — which is why the rule is
    // phrased on pages rather than on sheets and needs no format branch.
    const result = await extractWith(pagesOf(1, MAX_EXTRACTED_TEXT_CHARS * 2));

    expect(result.truncated).toBe(true);
    expect(result.markdown).toContain(CHARACTER_TRUNCATION_MARKER.trim());
    expect(result.markdown).not.toContain('sections shown');
    expect(result.markdown.length).toBeLessThanOrEqual(
      MAX_EXTRACTED_TEXT_CHARS,
    );
  });

  it('**5d. a single-page `.docx` inside the budget is untouched by any of this**', async () => {
    // The format-blindness claim, asserted rather than assumed: the page rule
    // never fires for a one-page document, so `.docx` behaves exactly as it
    // did before `.xlsx` had a parser, and needs no `if (mimeType === …)`
    // anywhere.
    const result = await extractWith({
      contentHash: 'x',
      pageCount: 0,
      failedPages: [],
      pages: [{ pageNumber: null, markdown: '# Policy\n\nTwelve paid days.' }],
    });

    expect(result).toEqual({
      markdown: '# Policy\n\nTwelve paid days.',
      truncated: false,
    });
  });
});
