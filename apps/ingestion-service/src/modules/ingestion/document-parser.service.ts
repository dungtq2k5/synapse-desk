import { Injectable, Logger } from '@nestjs/common';
import mammoth from 'mammoth';
import type { PageData } from 'pdf-parse-fork';

/** One page of extracted text. PDFs have many; everything else has one. */
export type ParsedPage = {
  /** 1-based, and NULL for formats with no pages. */
  pageNumber: number | null;
  markdown: string;
};

export type ParsedDocument = {
  pages: ParsedPage[];
  /** sha256 of the actual BYTES — see the note in `parse`. */
  contentHash: string;
};

/**
 * Bytes -> markdown, per format.
 *
 * **Markdown rather than plain text**, because the headings are what the
 * chunker splits on and what turns a retrieved chunk into "page 4, §2.1"
 * instead of a character offset. Extracting to plain text throws that structure
 * away at the one moment it is still present.
 *
 * **Page numbers survive for PDFs and are NULL elsewhere**, rather than being
 * faked as 1. A DOCX has no pages until something paginates it, and a citation
 * that says "page 1" of a fifty-page Word document is worse than one that says
 * nothing — it is confidently wrong, and a user who clicks through learns not
 * to trust citations.
 */
@Injectable()
export class DocumentParserService {
  private readonly logger = new Logger(DocumentParserService.name);

  /**
   * `fileType` decides the parser, and an unknown one is refused rather than
   * guessed at.
   *
   * The type came from `FILE_TYPE_BY_MIME` at confirm time, which itself came
   * from storage-service reading the object's real content type rather than the
   * client's claim — so by here it is trustworthy, and anything unrecognised is
   * a gap in the allowlist rather than a hostile upload.
   */
  async parse(bytes: Buffer, fileType: string): Promise<ParsedDocument> {
    // The hash is of the BYTES, which is the honest fingerprint and could not
    // be computed at confirm time: the bytes never pass through this service on
    // the upload path — that is the point of presign — so `documents.file_hash`
    // is a hash of the object path and dedups repeated CONFIRMS of one upload.
    // Content dedup belongs here, where the bytes are already in hand.
    const { createHash } = await import('node:crypto');
    const contentHash = createHash('sha256').update(bytes).digest('hex');

    const pages = await this.extract(bytes, fileType);

    return { pages, contentHash };
  }

  private async extract(
    bytes: Buffer,
    fileType: string,
  ): Promise<ParsedPage[]> {
    switch (fileType) {
      case 'pdf':
        return this.parsePdf(bytes);
      case 'docx':
      case 'doc':
        return this.parseDocx(bytes);
      case 'md':
      case 'txt':
        // Already text. Markdown passes through untouched, and plain text is
        // valid markdown with no headings — the chunker falls back to length
        // splitting, which is the correct behaviour for a file with no
        // structure to preserve.
        return [{ pageNumber: null, markdown: bytes.toString('utf8') }];
      default:
        throw new Error(`No parser for file type '${fileType}'`);
    }
  }

  /**
   * PDF -> one entry per page.
   *
   * `pagerender` is what makes page numbers real. The default extraction
   * concatenates the whole document into one string, and recovering page
   * boundaries afterwards means guessing at form feeds — which is how "page 4"
   * becomes approximately page 4.
   */
  private async parsePdf(bytes: Buffer): Promise<ParsedPage[]> {
    const pages: ParsedPage[] = [];

    const renderPage = async (pageData: PageData): Promise<string> => {
      const content = await pageData.getTextContent({
        normalizeWhitespace: true,
        disableCombineTextItems: false,
      });
      const text = content.items.map((item) => item.str).join(' ');

      pages.push({ pageNumber: pages.length + 1, markdown: text });

      return text;
    };

    // Required lazily. `pdf-parse-fork` reads a test fixture from disk at
    // module load in some versions, which makes an eager import fail in
    // environments that do not have it — a startup crash for a dependency the
    // service may never use in that process.
    const { default: pdfParse } = await import('pdf-parse-fork');

    await pdfParse(bytes, { pagerender: renderPage });

    return pages.filter((page) => page.markdown.trim().length > 0);
  }

  /**
   * DOCX -> markdown, headings preserved.
   *
   * `convertToHtml` then a narrow HTML->markdown pass, rather than mammoth's
   * `extractRawText`: raw text discards the heading levels, and the heading
   * levels are the entire reason for converting to markdown at all.
   */
  private async parseDocx(bytes: Buffer): Promise<ParsedPage[]> {
    const result = await mammoth.convertToHtml({ buffer: bytes });

    if (result.messages.length > 0) {
      this.logger.debug(
        `mammoth reported ${result.messages.length} conversion message(s)`,
      );
    }

    return [{ pageNumber: null, markdown: htmlToMarkdown(result.value) }];
  }
}

/**
 * A deliberately SMALL HTML -> markdown conversion.
 *
 * It handles headings, paragraphs, list items and line breaks, and strips
 * everything else. A general-purpose converter would be more faithful and
 * would also carry a large dependency to serve a single caller whose output is
 * consumed by a text splitter and an embedding model — neither of which can
 * tell a table from a paragraph.
 *
 * Headings are the part that must be right, because they are what the chunker
 * splits on and what a citation names.
 */
function htmlToMarkdown(html: string): string {
  const structured = html
    .replace(
      /<h([1-6])>(.*?)<\/h\1>/gi,
      (_match, level: string, text: string) =>
        `\n${'#'.repeat(Number(level))} ${stripTags(text)}\n`,
    )
    .replace(
      /<li>(.*?)<\/li>/gi,
      (_match, text: string) => `- ${stripTags(text)}\n`,
    )
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n');

  return stripHtmlTags(structured)
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Removes `<...>` tags, scanning rather than matching.
 *
 * The obvious `/<[^>]+>/g` is QUADRATIC on hostile input, and this input is
 * hostile by definition — it is the contents of a document a tenant uploaded.
 * The blowup needs two things: many `<` to start from, and no `>` to find. On
 * `"<a".repeat(n)` the engine starts at every `<`, scans to the end of the
 * string, fails, and gives up that start position — measured at 0.9s for 80KB
 * and growing with the square, so a few MB of it occupies an ingestion worker
 * for hours. Because that worker drains a queue, it is the whole tenant's
 * ingestion that stalls, not one document.
 *
 * `indexOf` cannot backtrack, so this is linear no matter what it is fed.
 *
 * Behaviour is otherwise IDENTICAL to the regex, including the two cases worth
 * naming: `<>` is left alone (the pattern required at least one character), and
 * so is an unterminated `<foo` with no closing `>`.
 */
function stripHtmlTags(text: string): string {
  let out = '';
  let cursor = 0;

  for (;;) {
    const open = text.indexOf('<', cursor);
    if (open === -1) return out + text.slice(cursor);

    const close = text.indexOf('>', open + 1);
    // Unterminated: nothing after this point can be a tag either, so the rest
    // is literal.
    if (close === -1) return out + text.slice(cursor);

    if (close === open + 1) {
      // `<>` — not a tag. Keep it and carry on past it.
      out += text.slice(cursor, close + 1);
    } else {
      out += text.slice(cursor, open);
    }
    cursor = close + 1;
  }
}

function stripTags(text: string): string {
  return stripHtmlTags(text).trim();
}
