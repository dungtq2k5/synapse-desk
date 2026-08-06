/**
 * `pdf-parse-fork` ships no types, and the untyped default export makes every
 * call `any` — which silently disables checking on the one callback whose shape
 * this service actually depends on.
 *
 * Only the surface `DocumentParserService` uses is declared. A fuller
 * declaration would be more faithful to the library and less useful: it would
 * describe options nothing here passes, and be wrong in ways nothing would
 * catch.
 */
declare module 'pdf-parse-fork' {
  /** The per-page hook. Its return value becomes that page's text. */
  export type PageData = {
    getTextContent: (options: {
      normalizeWhitespace?: boolean;
      disableCombineTextItems?: boolean;
    }) => Promise<{ items: Array<{ str: string }> }>;
  };

  export type PdfParseOptions = {
    pagerender?: (pageData: PageData) => Promise<string>;
    max?: number;
  };

  export type PdfParseResult = {
    numpages: number;
    text: string;
  };

  export default function pdfParse(
    data: Buffer,
    options?: PdfParseOptions,
  ): Promise<PdfParseResult>;
}
