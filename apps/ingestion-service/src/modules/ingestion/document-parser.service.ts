import { Injectable, Logger } from '@nestjs/common';
import { MIN_PAGE_CHARACTERS } from '@synapsedesk/common';
import { MAX_OCR_PAGES, OcrService } from './ocr.service';

/** One page of extracted text. PDFs have many; everything else has one. */
export type ParsedPage = {
  /** 1-based, and NULL for formats with no pages. */
  pageNumber: number | null;
  markdown: string;
  /**
   * How the text was obtained
   *
   * `ocr` text is FLAT: tesseract emits no headings, so an OCR'd page falls
   * through to the chunker's length-based split exactly as a `.txt` file does,
   * and its citations are less precise than a born-digital page's. That is
   * enormously better than the page being absent, and recording it is what
   * lets somebody reading a vague citation know why.
   */
  source?: 'text' | 'ocr';
};

export type ParsedDocument = {
  pages: ParsedPage[];
  /** sha256 of the actual BYTES — see the note in `parse`. */
  contentHash: string;
  /**
   * How many pages the document HAS, which is not `pages.length`
   *
   * Pages with no usable text are absent from `pages`, so this is the only way
   * downstream can tell that page 7 existed at all. §6's check compares the
   * page numbers that survived chunking against this number, which is the one
   * comparison that catches BOTH silent drops: the parser's filter and the
   * chunker's `MIN_CHUNK_TOKENS`.
   *
   * Zero for formats with no pages.
   */
  pageCount: number;
  /** Page numbers OCR was tried on and did not produce usable text for. */
  failedPages: number[];
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
 * Bytes -> markdown, per format
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
 *
 * **A tenant's document never leaves the deployment, and never touches the
 * disk** That is the requirement; "100% in-process", which this
 * docblock used to claim, was the shape the requirement happened to take before
 * OCR existed.
 *
 * The claim changed because scanned pages now run `pdftoppm` and `tesseract`,
 * which are system binaries. **All three reasons behind the original rule
 * survive that**: the binaries are in our own image, so no document reaches a
 * third party; they bill nothing per page; and their failure mode is garbled
 * text rather than *better output*, which is what made a vision-API parser
 * dangerous — nothing would have looked wrong.
 *
 * **What "never touches the disk" is buying**, and why it is stated rather than
 * assumed: both tools accept stdin and write stdout, so the PDF is piped in and
 * the rendered image never lands (§3.1). "Documents never leave the deployment"
 * reads as an empty promise if the same document is sitting in `/tmp` while it
 * is read, and the temp-file alternative was rejected for exactly that reason.
 *
 * `document-parser.service.spec.ts` asserts all three halves: the network
 * stubbed to throw, the subprocess table, and an empty `TMPDIR` after a scanned
 * page.
 */
@Injectable()
export class DocumentParserService {
  private readonly logger = new Logger(DocumentParserService.name);

  constructor(private readonly ocr: OcrService) {}

  /**
   * `fileType` decides the parser, and an unknown one is refused rather than
   * guessed at.
   *
   * The type came from `FILE_TYPE_BY_MIME` at confirm time, which itself came
   * from storage-service reading the object's real content type rather than the
   * client's claim — so by here it is trustworthy, and anything unrecognised is
   * a gap in the allowlist rather than a hostile upload.
   */
  async parse(
    bytes: Buffer,
    fileType: string,
    /**
     * ISO 639-1 codes for OCR
     *
     * Arrives on `DocumentUploadedEvent` rather than being read from the
     * document row, so the worker still needs no lookup to start. Empty is
     * "not specified", which is almost every document.
     */
    ocrLanguages: string[] = [],
  ): Promise<ParsedDocument> {
    // The hash is of the BYTES, which is the honest fingerprint and could not
    // be computed at confirm time: the bytes never pass through this service on
    // the upload path — that is the point of presign — so `documents.file_hash`
    // is a hash of the object path and dedups repeated CONFIRMS of one upload.
    // Content dedup belongs here, where the bytes are already in hand.
    const { createHash } = await import('node:crypto');
    const contentHash = createHash('sha256').update(bytes).digest('hex');

    if (fileType === 'pdf') {
      const { pages, pageCount, failedPages } = await this.parsePdf(
        bytes,
        ocrLanguages,
      );

      return { pages, contentHash, pageCount, failedPages };
    }

    const pages = await this.extract(bytes, fileType);

    // One "page" that is not a page — DOCX, TXT and MD have no pagination, so
    // there is nothing for §6 to count and nothing that could go missing
    // page-wise.
    return { pages, contentHash, pageCount: 0, failedPages: [] };
  }

  private async extract(
    bytes: Buffer,
    fileType: string,
  ): Promise<ParsedPage[]> {
    switch (fileType) {
      case 'pdf':
        return (await this.parsePdf(bytes, [])).pages;
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
   * PDF -> one `ParsedPage` per page, via **pdfjs-dist**.
   *
   * **Page-by-page is the citation guarantee**, and it is why this does not use
   * a converter that returns one string
   *
   * Trap 2 of §3.2 is the package landscape here, and it is genuinely
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
    ocrLanguages: string[],
  ): Promise<{
    pages: ParsedPage[];
    pageCount: number;
    failedPages: number[];
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
      // **Pointed at the package's own bundled fonts** F5.
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
    // document unusable and this number outlives it — §6 compares against it.
    const pageCount = document.numPages;

    try {
      for (let number = 1; number <= document.numPages; number++) {
        const page = await document.getPage(number);
        const content = await page.getTextContent();
        const markdown = toLines(content.items);

        // **"Too little", not "empty"** `trim().length > 0` was
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
   * whole file (§3.1), and N of those at once multiplies peak memory by N on a
   * worker that is also embedding.
   */
  private async ocrThinPages(
    bytes: Buffer,
    thin: number[],
    ocrLanguages: string[],
    into: ParsedPage[],
  ): Promise<number[]> {
    if (thin.length === 0) return [];

    const failed: number[] = [];
    // Past the cap, pages are RECORDED as failures rather than dropped — "we
    // stopped after fifty" and "page fifty-one could not be read" are the same
    // fact to whoever reads the flag: part of this document is not searchable.
    const attempt = thin.slice(0, MAX_OCR_PAGES);
    failed.push(...thin.slice(MAX_OCR_PAGES));

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
        failed.push(pageNumber);
      }
    }

    return failed.sort((a, b) => a - b);
  }

  /**
   * DOCX -> markdown, via **mammoth then turndown** F1.
   *
   * **It is easy to misdiagnose which half was broken**
   * "Mammoth plus custom regular expressions" reads as one failing unit and is
   * not: mammoth was the working half, and the 80-line hand-written
   * `htmlToMarkdown` after it was the liability. Replacing that one function
   * with turndown fixes the actual defect, and always could have.
   *
   * This also replaced `@aidalinfo/office-to-markdown`, taken earlier on the
   * strength of its two advertised features — GFM tables and OMML math — **both
   * of which are broken** (traps 6 and 7). It is a thin wrapper around these
   * same two packages (`jszip`, `mammoth`, `turndown`) plus a layer that damages
   * both of turndown's relevant outputs: tables without a GFM delimiter row, and
   * OMML converted to double-escaped LaTeX that renders as a literal `\frac`.
   * Undoing that in a repair pass was the worst position available — depending
   * on a package *and* maintaining patches for it, where an upstream fix would
   * silently double the repair.
   *
   * `turndown-plugin-gfm` emits correct tables, delimiter row included, which
   * is the whole reason it exists.
   *
   * **Math is dropped, and that is the trade.** Mammoth ignores OMML, so a
   * formula becomes absent rather than wrong. The chunk text is *embedded*, and
   * an embedding model reads `$\frac{1}{2}$` as a string — LaTeX buys no
   * retrieval quality over `1/2` and tokenizes worse. If a tenant ever needs
   * formulas, mammoth's `transformDocument` hook is where an OMML step goes.
   */
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
 * pdfjs-dist is ESM-only — there is no CJS build in v4 or v5, and its `main` is
 * a `.mjs` — and this service compiles to CommonJS, where TypeScript downlevels
 * `await import()` into a plain `require()`. That works in production because
 * Node >= 22.12 can `require()` an ESM module, but it does NOT work under jest,
 * whose module registry intercepts `require` and hands the `.mjs` to a CJS
 * transformer that then chokes on `import.meta.url`.
 *
 * **This package is the ONLY reason `engines.node` is pinned.** Every other
 * dependency in the parsing stack is require-able on any Node: mammoth,
 * turndown and turndown-plugin-gfm are real CommonJS, and js-tiktoken and
 * @langchain/textsplitters declare `type: module` but ship `.cjs` entries.
 * Drop pdfjs and the floor goes with it.
 *
 * `process.getBuiltinModule('module')` returns the real builtin regardless of
 * the sandbox, so the require below is Node's, and the same code path runs in
 * tests and in production. The alternative — mocking pdfjs in unit tests —
 * would leave the page-number guarantee, which is what every citation in the
 * product resolves to, asserted against a fake.
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
 * A PDF has no lines — only runs with a transform matrix — so the previous
 * implementation joined every run on a page with a space and produced one
 * enormous paragraph. That is not a cosmetic problem: the chunker splits on
 * paragraph and line boundaries, so a page with none of either falls straight
 * through to a hard character cut, and every chunk from every PDF began
 * mid-sentence.
 *
 * `transform[5]` is the Y translation. Runs are grouped by it within a
 * tolerance, then ordered top-to-bottom — PDF Y grows upward, hence the
 * descending sort.
 *
 * **KNOWN LIMITATION: two-column PDFs merge into nonsense** F3.
 * Grouping by Y alone means two columns at the same vertical position
 * concatenate, so every line of a two-column policy document becomes
 * left-column text followed by right-column text.
 *
 * **Recorded rather than fixed, deliberately.** An X-gap heuristic has its own
 * false positives — a table's cells look exactly like columns — and a wrong
 * split is worse than an honest limitation, because it produces plausible
 * sentences that were never in the document. Build it when a tenant's corpus is
 * known to contain two-column documents, and test it against THAT corpus rather
 * than a synthetic one.
 *
 * `join('')` rather than `join(' ')` is safe and was verified: pdf.js emits
 * explicit space items, so adjacent runs do not run together.
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

/** The shape of mammoth's document model this walk touches, and no more. */
type MammothElement = {
  type?: string;
  isHeader?: boolean;
  children?: MammothElement[];
};

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
