/**
 * Engine tuning for scanned-page OCR — 34-doc §3.
 *
 * Read by the ingestion worker only; none of it reaches the API. The OCR values
 * that ARE API contract — `OCR_LANGUAGES`, `TESSERACT_CODE_BY_LANGUAGE`,
 * `NON_LATIN_OCR_LANGUAGES`, `MAX_OCR_LANGUAGES` — live in `document.config`.
 */

/**
 * Below this many extracted characters, a PDF page is treated as an image and
 * sent to OCR — 34-doc §3.2.
 *
 * Deliberately biased to over-OCR: re-reading a sparse but genuine page costs
 * one page of CPU, while missing an image page loses it from the corpus.
 */
// No character floor can fully separate the two populations — a scanner stamp
// ("Scanned by CamScanner", 21 chars) and a real title page ("Employee Handbook
// 2026", 22 chars) are the same size. Pages this misses are caught instead by
// §6's post-chunking page check. Ending the guessing needs a stronger signal —
// asking pdf.js whether a full-page image covers the page — not a new number.
export const MIN_PAGE_CHARACTERS = 32;

/**
 * Rasterization density handed to `pdftoppm`.
 *
 * 300 is the conventional floor for OCR accuracy. Test fixtures render at 150,
 * which is enough for tesseract and halves the bytes through the pipe.
 */
export const OCR_DPI = 300;

/**
 * How long ONE STAGE may run before it is SIGKILLed.
 *
 * A page runs two stages — `pdftoppm` then `tesseract` — each with its own full
 * budget, so the worst case for one page is twice this.
 */
// SIGKILL rather than rejecting the promise: giving up while tesseract keeps
// running leaks a process per page.
export const OCR_STAGE_TIMEOUT_MS = 30_000;

/**
 * How many pages of one document may be OCR'd.
 *
 * Pages past the cap are reported by the same §6 check that reports an OCR
 * failure, not silently dropped.
 */
// This is what bounds worker occupancy: 50 pages x 2 stages x
// OCR_STAGE_TIMEOUT_MS is a 50-minute worst case on one worker, and no BullMQ
// job timeout sits above it. Lower this or the stage timeout if a queue ever
// backs up behind one document.
export const MAX_OCR_PAGES_PER_DOCUMENT = 50;
