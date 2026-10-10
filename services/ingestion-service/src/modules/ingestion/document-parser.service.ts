import { Injectable, Logger } from '@nestjs/common';
import {
  MAX_SHEET_ROWS,
  MIN_PAGE_CHARACTERS,
  rowTruncationMarker,
  type OcrLanguage,
} from '@synapsedesk/common';
import { MAX_OCR_PAGES, OcrService, type OcrFailure } from './ocr.service';

/** One page of extracted text. PDFs have many; everything else has one. */
export type ParsedPage = {
  /** 1-based, and NULL for formats with no pages. */
  pageNumber: number | null;
  markdown: string;
  /**
   * How the text was obtained.
   *
   * `ocr` text is FLAT: tesseract emits no headings, so an OCR'd page falls
   * through to the chunker's length-based split exactly as a `.txt` file does,
   * and its citations are less precise than a born-digital page's. That is
   * enormously better than the page being absent, and recording it is what
   * lets somebody reading a vague citation know why.
   */
  source?: 'text' | 'ocr';
};

/**
 * Why one page produced no indexable text.
 *
 * **Wider than `OcrFailure`, and it has to be.** `OcrFailure` is the return type
 * of `recognisePage` — it describes what happened to a page that REACHED OCR,
 * and all four members are outcomes of an attempt. Pages past
 * `MAX_OCR_PAGES` never reach it, so borrowing a member for them would be a
 * lie in the one direction that matters: `binary_missing` is what the processor
 * keys on to report a deployment fault, and a merely-capped document on a
 * healthy deployment would then tell its tenant to contact an administrator.
 *
 * `OcrFailure` is unchanged. It was already honest about being one function's
 * return type; what was missing is a vocabulary for the page that never got
 * there.
 */
export type PageFailure = OcrFailure | 'page_cap';

/** One page that produced nothing, and why. */
export type FailedPage = {
  pageNumber: number;
  reason: PageFailure;
};

export type ParsedDocument = {
  pages: ParsedPage[];
  /** sha256 of the actual BYTES — see the note in `parse`. */
  contentHash: string;
  /**
   * How many pages the document HAS, which is not `pages.length`.
   *
   * Pages with no usable text are absent from `pages`, so this is the only way
   * downstream can tell that page 7 existed at all. The page-count check compares the
   * page numbers that survived chunking against this number, which is the one
   * comparison that catches BOTH silent drops: the parser's filter and the
   * chunker's `MIN_CHUNK_TOKENS`.
   *
   * Zero for formats with no pages.
   */
  pageCount: number;
  /**
   * Pages that produced no usable text, each with its reason.
   *
   * **Not every gap in a document is in here**, which is the thing to know
   * before reading it as a complete account. A page that OCR'd successfully into
   * eight tokens is `ok: true`, never enters this list, and then vanishes at the
   * chunker's `MIN_CHUNK_TOKENS`. `reportMissingPages` derives its own missing
   * set for exactly that reason and PARTITIONS it against this one.
   */
  failedPages: FailedPage[];
};

/**
 * How far apart two text items must be vertically to be different LINES.
 *
 * PDF text has no line concept — only positioned runs — so lines are inferred
 * from the transform matrix's Y translation. A tolerance rather than equality
 * because a superscript or a font change nudges the baseline by a fraction of
 * a point without starting a new line.
 */
const LINE_TOLERANCE_Y = 2;

/**
 * Bytes -> markdown, per format.
 *
 * **Markdown rather than plain text**, because the headings are what the chunker
 * splits on and what turns a retrieved chunk into "page 4, §2.1" instead of a
 * character offset.
 *
 * **Page numbers survive for PDFs and are NULL elsewhere**, never faked as 1. A
 * DOCX has no pages until something paginates it, and a citation saying "page 1"
 * of a fifty-page document is confidently wrong.
 *
 * **A tenant's document never leaves the deployment and never touches the
 * disk.** Scanned pages shell out to `pdftoppm` and `tesseract`, but both accept
 * stdin and write stdout, so the rendered image never lands.
 * `document-parser.service.spec.ts` asserts all three halves: network stubbed to
 * throw, the subprocess table, and an empty `TMPDIR` after a scanned page.
 *
 * See `docs/decisions/0016-ocr-is-a-per-page-branch.md`.
 */
@Injectable()
export class DocumentParserService {
  private readonly logger = new Logger(DocumentParserService.name);

  constructor(private readonly ocr: OcrService) {}

  /**
   * `fileType` decides the parser, and an unknown one is refused rather than
   * guessed at.
   *
   * The type is an EXTENSION, translated from the object's MIME type by
   * `extensionFor` — `FILE_TYPE_BY_MIME` appeared here for a long time and has
   * never existed. Either caller reaches it the same way, and in both cases the
   * MIME type came from storage-service reading the object's real content type
   * rather than the client's claim. So by here it is trustworthy, and anything
   * unrecognized is a gap in the allowlist rather than a hostile upload.
   */
  async parse(
    bytes: Buffer,
    fileType: string,
    /**
     * ISO 639-1 codes for OCR.
     *
     * Arrives on `DocumentUploadedEvent` rather than being read from the
     * document row, so the worker still needs no lookup to start. Empty is
     * "not specified", which is almost every document.
     */
    ocrLanguages: OcrLanguage[] = [],
  ): Promise<ParsedDocument> {
    // The hash is of the BYTES, which is the honest fingerprint and could not
    // be computed at confirm time: the bytes never pass through this service on
    // the upload path — that is the point of presign — so `documents.file_hash`
    // is a hash of the object path and dedups repeated CONFIRMS of one upload.
    // Content dedup belongs here, where the bytes are already in hand.
    const { createHash } = await import('node:crypto');
    const contentHash = createHash('sha256').update(bytes).digest('hex');

    // **PDF returns here and never reaches `extract()`**, which is why that
    // switch has no `pdf` arm. It is the one format with a page count, failed
    // pages and OCR languages to thread — three values the paginationless
    // formats below have nothing to say about.
    if (fileType === 'pdf') {
      const { pages, pageCount, failedPages } = await this.parsePdf(
        bytes,
        ocrLanguages,
      );

      return { pages, contentHash, pageCount, failedPages };
    }

    const pages = await this.extract(bytes, fileType);

    // One "page" that is not a page — DOCX, XLSX, TXT and MD have no pagination,
    // so there is nothing for the page-count check to count and nothing that
    // could go missing page-wise. A workbook's SHEETS are pages here, and a
    // sheet is not something that can go missing.
    return { pages, contentHash, pageCount: 0, failedPages: [] };
  }

  private async extract(
    bytes: Buffer,
    fileType: string,
  ): Promise<ParsedPage[]> {
    switch (fileType) {
      // No `pdf` arm: `parse()` returns above before reaching this. There was
      // one, and it was unreachable AND wrong — it called
      // `parsePdf(bytes, [])`, dropping the uploader's declared OCR languages,
      // so the day something did reach it a scanned Vietnamese document would
      // have been read as English with no error anywhere.
      case 'docx':
        // `docx` alone. `doc` used to fall through to here and could never have
        // worked — mammoth reads OOXML, and a Word 97-2003 file is OLE2. It is
        // no longer an accepted document type, so this switch cannot see one.
        return this.parseDocx(bytes);
      case 'xlsx':
        // ATTACHMENTS only today — `.xlsx` is not in
        // `ALLOWED_DOCUMENT_MIME_TYPES`, so it arrives here from
        // `AttachmentExtractorService` and never from an ingestion job. Here
        // rather than in that service because this class is the one owner of
        // "bytes → markdown", and because promoting spreadsheets to knowledge
        // base content later should be a list edit rather than moving code
        // between services.
        return this.parseXlsx(bytes);
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
   * PDF -> one `ParsedPage` per page, via **pdfjs-dist**.
   *
   * **Page-by-page is the citation guarantee**, and it is why this does not use
   * a converter that returns one string.
   *
   * Trap 2 is the package landscape here, and it is genuinely
   * confusing: `@opendocsg/pdf2md` returns the whole document with
   * `<!-- PAGE_BREAK -->` markers, so page numbers survive only by splitting a
   * magic comment; the bare `pdf2md` on npm is not a text extractor at all — it
   * shells out through `child_process`, writes intermediate files and emits
   * image links; and a third, similarly-named package calls a vision API per
   * page, which violates the offline requirement, spends money per page and
   * sends tenant documents to a third party. **Using pdfjs-dist directly makes
   * the question disappear.**
   *
   * This also replaces `pdf-parse-fork`, whose bundled pdf.js is from 2018 and
   * misread a Node `Buffer` — resolving offsets against the wrong bytes and
   * failing intermittently as though the customer's file were corrupt.
   */
  private async parsePdf(
    bytes: Buffer,
    ocrLanguages: OcrLanguage[],
  ): Promise<{
    pages: ParsedPage[];
    pageCount: number;
    failedPages: FailedPage[];
  }> {
    const pdfjs = loadPdfjs();

    const task = pdfjs.getDocument({
      // A plain `Uint8Array`. pdf.js takes ownership of the buffer it is given
      // and neuters it, so handing over the caller's `Buffer` would leave the
      // caller holding an emptied view of its own bytes.
      data: new Uint8Array(bytes),
      // No eval, no external font fetches, no system fonts. Each of these is a
      // way for a hostile document to reach outside the parse — and the last
      // two are what keep this provably offline.
      //
      // Cast because pdfjs-dist v5 types the parameter as a union whose object
      // arm is not exported, so an object literal is checked against the
      // TypedArray arm and every option reads as excess. The options are real;
      // the type is what is narrow.
      isEvalSupported: false,
      useSystemFonts: false,
      // **Pointed at the package's own bundled fonts.**
      //
      // `undefined` made pdf.js log `UnknownErrorException: Ensure that the
      // standardFontDataUrl API parameter is provided` once per document, on
      // the busiest path in this service. Harmless, and log noise on a hot path
      // is how a genuinely important warning stops being read.
      //
      // Still fully offline: these are files inside `node_modules`, not a URL.
      // The trailing slash is required — pdf.js concatenates a filename onto it.
      standardFontDataUrl: standardFontsPath(),
    } as Parameters<typeof pdfjs.getDocument>[0]);

    const document = await task.promise;
    const pages: ParsedPage[] = [];
    const thin: number[] = [];
    // Read before the loop, because `task.destroy()` in the `finally` makes the
    // document unusable and this number outlives it — the page-count check compares against it.
    const pageCount = document.numPages;

    try {
      for (let number = 1; number <= document.numPages; number++) {
        const page = await document.getPage(number);
        const content = await page.getTextContent();
        const markdown = toLines(content.items);

        // **"Too little", not "empty"**. `trim().length > 0` was
        // the wrong test: a page carrying a scanner stamp or a partial OCR
        // layer has a handful of characters and is still an image.
        if (markdown.trim().length >= MIN_PAGE_CHARACTERS) {
          pages.push({ pageNumber: number, markdown, source: 'text' });
        } else {
          thin.push(number);
        }

        page.cleanup();
      }
    } finally {
      // Always: a `getDocument` task holds a worker, and leaking one per failed
      // parse is how an ingestion worker slowly stops responding.
      await task.destroy();
    }

    const failedPages = await this.ocrThinPages(
      bytes,
      thin,
      ocrLanguages,
      pages,
    );

    // Sorted, because OCR'd pages are appended as they complete and a citation
    // that resolves to "page 4" must come from a list where 4 follows 3.
    pages.sort((a, b) => (a.pageNumber ?? 0) - (b.pageNumber ?? 0));

    return { pages, pageCount, failedPages };
  }

  /**
   * OCR for the pages pdf.js could not read
   *
   * **Only the thin ones.** A 200-page PDF with two scanned pages pays for two,
   * and the text pages keep pdf.js's extraction, which is better than OCR of a
   * render of the same page. That is the entire argument for doing this per
   * page rather than per document.
   *
   * Sequential rather than parallel: each page already runs `pdftoppm` over the
   * whole file, and N of those at once multiplies peak memory by N on a
   * worker that is also embedding.
   */
  private async ocrThinPages(
    bytes: Buffer,
    thin: number[],
    ocrLanguages: OcrLanguage[],
    into: ParsedPage[],
  ): Promise<FailedPage[]> {
    if (thin.length === 0) return [];

    const failed: FailedPage[] = [];
    // Past the cap, pages are RECORDED as failures rather than dropped. This
    // used to say that "we stopped after fifty" and "page fifty-one could not be
    // read" are the same fact to whoever reads the flag — true while this list
    // carried only WHICH pages, and false the moment it carries WHY, because
    // those are precisely the two facts the reader now has to tell apart.
    //
    // `page_cap`, never an `OcrFailure` member: these pages never reached OCR,
    // and the processor keys on `binary_missing` to report a server fault.
    const attempt = thin.slice(0, MAX_OCR_PAGES);
    failed.push(
      ...thin
        .slice(MAX_OCR_PAGES)
        .map((pageNumber) => ({ pageNumber, reason: 'page_cap' as const })),
    );

    if (failed.length > 0) {
      this.logger.warn(
        `Document has ${thin.length} pages needing OCR; capped at ${MAX_OCR_PAGES}`,
      );
    }

    for (const pageNumber of attempt) {
      const result = await this.ocr.recognisePage(
        bytes,
        pageNumber,
        ocrLanguages,
      );

      if (result.ok) {
        into.push({
          pageNumber,
          markdown: result.text,
          source: 'ocr',
        });
      } else {
        // The reason stops dying here. It was already typed by `recognisePage`
        // and its docblock already said it was "carried upward so the page-count
        // check can report it" — this is the hop that makes that true.
        failed.push({ pageNumber, reason: result.reason });
      }
    }

    return failed.sort((a, b) => a.pageNumber - b.pageNumber);
  }

  /**
   * XLSX -> markdown, one `ParsedPage` per WORKSHEET.
   *
   * Each page opens with its own `## Sheet: <name>` heading, so
   * `AttachmentExtractorService`'s existing `pages.map(…).join('\n\n')` produces
   * the whole workbook with no format-specific assembly anywhere.
   *
   * **`load()`, not the streaming `WorkbookReader`, which is the opposite of
   * why this library is here.** The streaming reader was the stated reason for
   * choosing exceljs
   * over SheetJS: `MAX_SHEET_ROWS` as an early exit, so row 501 is never built
   * and peak memory tracks the cap rather than the file. Measured against
   * 4.4.0, it also crashes:
   *
   * | input | runs | crashes |
   * | :--- | :--- | :--- |
   * | 1 sheet | 60 | **0** |
   * | 3 sheets | 200 | **103** |
   *
   * `TypeError: Cannot read properties of undefined (reading 'sheets')` at
   * `workbook-reader.js:303`, which reads `this.model.sheets` with no guard on
   * `this.model`. Reproduced under every option combination the reader accepts.
   * `load()` over the same 3-sheet workbook: 200 runs, 0 crashes, sheet order
   * correct every time.
   *
   * **So the cap here is a post-hoc slice, which is what §2 wanted to avoid.**
   * The whole workbook is materialized before a row is dropped, putting `.xlsx`
   * exactly where `.docx` already sits — mammoth's `convertToHtml({ buffer })`
   * reads the whole document too. Recorded as known-gaps #17 rather than
   * papered over: adding this format did not widen that gap, but it no longer
   * narrows it either.
   *
   * The library choice still stands. SheetJS's npm channel carries fixes that
   * cannot be installed from it; this one has a bug with a working path around
   * it.
   *
   * **`pageNumber` carries a SHEET INDEX, and that is latent wrongness rather
   * than a bug.** Nothing reads it: `pageCount` is 0 for this format and the
   * attachment path never chunks. It would become wrong the day `.xlsx` joins
   * `ALLOWED_DOCUMENT_MIME_TYPES`, because the citation surface would render
   * sheet 3 as "page 3". That fix belongs with whoever adds the list entry.
   *
   * Formulas are not extracted. exceljs exposes the formula and its cached
   * RESULT, and the result is what a reader wants; a workbook whose values were
   * never calculated extracts as empty, which is correct and indistinguishable
   * from an empty sheet.
   */
  private async parseXlsx(bytes: Buffer): Promise<ParsedPage[]> {
    const ExcelJS = await import('exceljs');

    const workbook = new ExcelJS.Workbook();
    // The cast bridges two `Buffer` declarations, not two runtime shapes:
    // exceljs's `load(buffer: Buffer)` resolves against its own bundled type,
    // whose `slice` disagrees with Node's on `Symbol.toStringTag`. The value is
    // a Node `Buffer` either way.
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer);

    const pages: ParsedPage[] = [];
    let sheetIndex = 0;

    workbook.eachSheet((worksheet) => {
      sheetIndex += 1;

      const rows: string[] = [];
      let seen = 0;

      worksheet.eachRow((row) => {
        seen += 1;
        if (rows.length < MAX_SHEET_ROWS) rows.push(toMarkdownRow(row));
        // Counted past the cap rather than stopped at it: the marker has to
        // name the sheet's REAL height, and stopping would report
        // "500 of 500" — a truncation notice saying nothing was truncated.
        //
        // **So this guard bounds the OUTPUT, not the work.** `eachRow` has no
        // early exit — the only overload option is `includeEmpty` — and
        // `load()` has already materialized every row before this runs. A
        // 50,000-row sheet is still 50,000 callbacks; what the cap saves is the
        // markdown, not the parse.
      });

      if (rows.length === 0) return;

      pages.push({
        pageNumber: sheetIndex,
        markdown: [
          `## Sheet: ${worksheet.name}`,
          '',
          ...withHeaderDelimiter(rows),
          ...(seen > rows.length
            ? ['', rowTruncationMarker(rows.length, seen)]
            : []),
        ].join('\n'),
      });
    });

    return pages;
  }

  private async parseDocx(bytes: Buffer): Promise<ParsedPage[]> {
    const mammoth = await import('mammoth');

    const { value: html, messages } = await mammoth.convertToHtml(
      { buffer: bytes },
      // **The first row of every table becomes a HEADER row.**
      //
      // Not cosmetic: `turndown-plugin-gfm` `keep()`s any table whose first row
      // is not `<th>` — it emits the raw `<table>` HTML verbatim rather than a
      // pipe table, which is worse than what the wrapper produced. Mammoth only
      // emits `<th>` when the DOCX marks the row with `w:tblHeader`, and most
      // real documents do not.
      //
      // Treating row 1 as the header is what a reader assumes and what the
      // deleted `addTableDelimiters` did implicitly. Done through mammoth's
      // documented `transformDocument` hook rather than by rewriting HTML,
      // because mammoth owns the question of what a row IS.
      { transformDocument: markFirstTableRowAsHeader },
    );

    if (messages.length > 0) {
      this.logger.debug(
        `mammoth reported ${messages.length} conversion message(s)`,
      );
    }

    return [{ pageNumber: null, markdown: htmlToMarkdown(html) }];
  }
}

/**
 * Loads pdfjs through **Node's own `require`**, not through `import()`.
 *
 * pdfjs-dist is ESM-only and this service compiles to CommonJS, where
 * TypeScript downlevels `await import()` into `require()`. That works in
 * production — Node >= 22.12 can `require()` an ESM module — but not under
 * jest, whose module registry intercepts `require` and hands the `.mjs` to a
 * CJS transformer that chokes on `import.meta.url`.
 *
 * **This package is the ONLY reason `engines.node` is pinned.** Every other
 * dependency in the parsing stack is require-able on any Node.
 *
 * `process.getBuiltinModule('module')` returns the real builtin regardless of
 * the sandbox, so the same code path runs in tests and in production. Mocking
 * pdfjs instead would leave the page-number guarantee — what every citation
 * resolves to — asserted against a fake.
 *
 * The `legacy` build specifically: the default entry targets browsers and pulls
 * in DOM globals that do not exist here.
 */
function loadPdfjs(): typeof import('pdfjs-dist/legacy/build/pdf.mjs') {
  const nodeRequire = process
    .getBuiltinModule('node:module')
    .createRequire(__filename);

  return nodeRequire(
    'pdfjs-dist/legacy/build/pdf.mjs',
  ) as typeof import('pdfjs-dist/legacy/build/pdf.mjs');
}

/** The directory holding pdfjs's bundled standard fonts, with a trailing slash. */
function standardFontsPath(): string {
  const nodeRequire = process
    .getBuiltinModule('node:module')
    .createRequire(__filename);

  // Resolved from the package rather than assembled from `__dirname`, so it
  // keeps working under a bundler or a hoisted install.
  const entry = nodeRequire.resolve('pdfjs-dist/package.json');

  return `${entry.replace(/package\.json$/, '')}standard_fonts/`;
}

/**
 * Groups positioned text runs into LINES.
 *
 * A PDF has no lines — only runs with a transform matrix — and joining every
 * run on a page produces one enormous paragraph. That is not cosmetic: the
 * chunker splits on paragraph and line boundaries, so a page with neither falls
 * through to a hard character cut and every chunk begins mid-sentence.
 *
 * `transform[5]` is the Y translation. Runs are grouped by it within a
 * tolerance, then ordered top-to-bottom — PDF Y grows upward, hence the
 * descending sort.
 *
 * **KNOWN LIMITATION: two-column PDFs merge into nonsense.** Grouping by Y
 * alone concatenates two columns at the same vertical position. Recorded rather
 * than fixed: an X-gap heuristic has its own false positives (a table's cells
 * look exactly like columns), and a wrong split produces plausible sentences
 * that were never in the document. Build it against a real two-column corpus.
 *
 * `join('')` rather than `join(' ')` is safe and was verified: pdf.js emits
 * explicit space items.
 */
function toLines(items: readonly unknown[]): string {
  const rows = new Map<number, { x: number; text: string }[]>();

  for (const item of items) {
    const run = item as { str?: string; transform?: number[] };
    if (typeof run.str !== 'string' || run.str === '') continue;

    const x = run.transform?.[4] ?? 0;
    const y = run.transform?.[5] ?? 0;

    // Snapped to the tolerance so near-equal baselines land in one bucket.
    const key = Math.round(y / LINE_TOLERANCE_Y) * LINE_TOLERANCE_Y;
    const row = rows.get(key) ?? [];
    row.push({ x, text: run.str });
    rows.set(key, row);
  }

  // Copied before sorting rather than `toSorted`, which needs ES2023 and this
  // repo targets ES2022. Same guarantee: nothing sorts an array in place that
  // somebody else holds a reference to.
  const ordered = [...rows.entries()].sort(([left], [right]) => right - left);

  return ordered
    .map(([, row]) =>
      [...row]
        .sort((left, right) => left.x - right.x)
        .map((entry) => entry.text)
        .join('')
        .trimEnd(),
    )
    .filter((line) => line.trim().length > 0)
    .join('\n');
}

/**
 * HTML -> markdown, via turndown with the GFM plugin.
 *
 * Built once and reused: turndown compiles its rule set on construction, and a
 * fresh instance per document would pay that on every ingestion job.
 *
 * `atx` headings because the chunker's pass 1 splits on `#`, and `fenced` code
 * because an indented block is indistinguishable from a quoted paragraph once
 * the surrounding HTML is gone.
 */
let turndownService: import('turndown') | undefined;

function htmlToMarkdown(html: string): string {
  turndownService ??= createTurndown();

  return turndownService.turndown(html);
}

/**
 * The two exceljs shapes this file touches, named locally.
 *
 * Imported as TYPES from a package loaded with a dynamic `import()` — the value
 * side stays lazy, which is what keeps `exceljs` off the startup path for every
 * document that is not a workbook.
 */
type ExcelRow = import('exceljs').Row;
type ExcelCell = import('exceljs').Cell;

/**
 * One spreadsheet row as a markdown table row.
 *
 * **`eachCell` with `includeEmpty`, not `row.values`.** Two things force this
 * pairing and each is a bug on its own:
 *
 * `row.values` hands back the RAW cell value, and for a cell with mixed inline
 * formatting that is `{ richText: [...] }` — an object with no `text`, no
 * `result` and no `Date` to unwrap, which the old hand-rolled formatter
 * rendered as an empty string. Rich text is what exceljs returns for any styled
 * cell, routinely the header row, and the table still rendered: the column was
 * simply blank and nothing reported it. `cell.text` is the library's own
 * rendering and handles rich text, errors, hyperlinks and formula results
 * alike.
 *
 * `includeEmpty` is what stops that fix introducing a worse one. Bare
 * `eachCell` SKIPS blank cells, so a row with A and C filled yields two values
 * against a three-column header and every column after the gap shifts by one —
 * the table still parses and one row silently disagrees with its header. With
 * the option it yields `['left', '', 'right']`, which is what `row.values` was
 * already giving.
 *
 * Pipes are escaped: an unescaped one inside a cell ends the cell early and
 * shifts the columns after it, for that row only.
 */
function toMarkdownRow(row: ExcelRow): string {
  const cells: string[] = [];

  row.eachCell({ includeEmpty: true }, (cell) => {
    cells.push(escapeCell(cellText(cell)));
  });

  return `| ${cells.join(' | ')} |`;
}

/**
 * One cell as text, with DATES taken from the value rather than from `text`.
 *
 * `cell.text` renders a date through the host's locale and timezone —
 * `Mon Mar 02 2026 07:00:00 GMT+0700 (Indochina Time)` — so the same workbook
 * extracts differently on two machines, and the result is noise for the model
 * besides. ISO is stable and shorter.
 *
 * Everything else defers to `cell.text`, which is exactly the point of using it.
 */
function cellText(cell: ExcelCell): string {
  if (cell.value instanceof Date) return cell.value.toISOString();

  return cell.text ?? '';
}

/**
 * The two substitutions a markdown table cell needs.
 *
 * `String.raw` rather than `'\\|'`: this function's whole job is escaping, and a
 * doubled backslash inside an escaping function is where a reader miscounts.
 * The newline replace keeps its regex, because `\r?\n` is a real alternation
 * rather than a literal being spelled the long way.
 */
function escapeCell(text: string): string {
  return text.replaceAll('|', String.raw`\|`).replaceAll(/\r?\n/g, ' ');
}

/**
 * The GFM delimiter row, inserted after the first row.
 *
 * Without it the whole block is paragraph text rather than a table — the same
 * failure `markFirstTableRowAsHeader` exists to prevent on the DOCX path, and
 * the reason that hook is called out in `parseDocx`'s docblock.
 */
function withHeaderDelimiter(rows: string[]): string[] {
  const [header, ...rest] = rows;
  const columns = header.split('|').length - 2;

  return [
    header,
    `| ${Array.from({ length: columns }, () => '---').join(' | ')} |`,
    ...rest,
  ];
}

/** The shape of mammoth's document model this walk touches, and no more. */
type MammothElement = {
  type?: string;
  isHeader?: boolean;
  children?: MammothElement[];
};

/**
 * Marks the first row of every table as a header row.
 *
 * Walks mammoth's document model rather than its HTML output — see the call
 * site for why this is needed at all. Immutable: mammoth's elements are shared,
 * and mutating one in place would affect any other reference to it.
 */
function markFirstTableRowAsHeader(node: MammothElement): MammothElement {
  if (!node || typeof node !== 'object') return node;

  let next = node;

  if (node.type === 'table' && node.children && node.children.length > 0) {
    const [first, ...rest] = node.children;

    if (first?.type === 'tableRow' && !first.isHeader) {
      next = { ...node, children: [{ ...first, isHeader: true }, ...rest] };
    }
  }

  return next.children
    ? { ...next, children: next.children.map(markFirstTableRowAsHeader) }
    : next;
}

function createTurndown(): import('turndown') {
  const nodeRequire = process
    .getBuiltinModule('node:module')
    .createRequire(__filename);

  const TurndownService = nodeRequire('turndown') as typeof import('turndown');
  const { gfm } = nodeRequire('turndown-plugin-gfm') as {
    gfm: (service: import('turndown')) => void;
  };

  const service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });

  // Tables, strikethrough and task lists. **The tables are the point** — the
  // plugin emits the `|---|` delimiter row that makes a pipe table a GFM table,
  // which is what the hand-written `addTableDelimiters` used to bolt on.
  service.use(gfm);

  // **A `<p>` inside a table cell contributes its text and nothing else.**
  //
  // Mammoth wraps every cell's content in `<p>`, and turndown's default
  // paragraph rule surrounds its output with blank lines — inside a cell those
  // newlines break the row across several lines and the table stops being a
  // table. The rule below is scoped to cells, so paragraphs everywhere else
  // keep their spacing.
  service.addRule('tableCellParagraph', {
    filter: (node) =>
      node.nodeName === 'P' &&
      (node.parentNode?.nodeName === 'TD' ||
        node.parentNode?.nodeName === 'TH'),
    replacement: (content) => content,
  });

  return service;
}
