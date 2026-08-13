/**
 * Scanned-page OCR — 34-doc §3.
 *
 * Here rather than in `ingestion-service` for the same reason `chunking.config`
 * is: one service reads these today, and a constant that lives beside the code
 * that uses it is a constant nobody finds when a second service needs it.
 *
 * **OCR constants live in TWO files, and the split is by audience.** This one
 * holds engine tuning — a threshold, a DPI, two ceilings — read only by the
 * worker, changed by whoever is watching it run, and invisible in the API.
 * `document.config` holds `OCR_LANGUAGES`, `TESSERACT_CODE_BY_LANGUAGE`,
 * `NON_LATIN_OCR_LANGUAGES` and `MAX_OCR_LANGUAGES`, which are the API
 * CONTRACT: the gateway validates uploads against them and they appear in a
 * DTO.
 *
 * Said out loud because this file is named as though it holds all of it, and a
 * reader who came looking for the language cap and found four unrelated
 * numbers would reasonably conclude the split was an accident.
 */

/**
 * Below this many extracted characters, a PDF page is treated as an image and
 * sent to OCR — 34-doc §3.2.
 *
 * **`trim().length > 0` was the wrong test**, which is why this exists at all:
 * scanners stamp headers, and some scanned PDFs carry a partial OCR layer that
 * yields a handful of junk characters. A page with four characters is an image
 * page that happened to catch a watermark.
 *
 * **Measured, and the measurement found something the design did not expect:
 * the two populations OVERLAP.** Characters extracted by pdf.js from a page:
 *
 * | Page | chars |
 * | :--- | ----: |
 * | Image page, nothing else | 0 |
 * | Image page + `"12"` page number | 2 |
 * | Image page + `"Scanned by CamScanner"` | **21** |
 * | Real section divider — `"Part III — Expenses"` | **19** |
 * | Real title page — `"Employee Handbook 2026"` | **22** |
 * | Image page + a long scanner header | 64 |
 * | Real notice — `"This page intentionally left blank."` | 35 |
 *
 * A scanner stamp and a title page are the same size. **No character floor can
 * separate them**, so this number cannot be correct — it can only be wrong in
 * the cheaper direction.
 *
 * **Which direction is cheaper is the whole argument.** OCR-ing a real title
 * page costs one page of CPU and returns the same words. NOT OCR-ing an image
 * page loses it silently, which is the bug this document exists to fix. So the
 * floor sits high enough to catch the common stamps and page numbers, and every
 * sparse-but-genuine page above it is a page that pays a second to tell us what
 * we already knew.
 *
 * **And a page this misses is no longer silent**, which is what makes an
 * imperfect threshold survivable: §6's post-chunking check compares the pages
 * present in the corpus against the page count the parser saw, so a page that
 * slipped through with 64 characters of scanner header and then failed to chunk
 * is reported rather than lost.
 *
 * The stronger signal — asking pdf.js whether a full-page image covers the
 * page — is what would end the guessing, and is the condition for revisiting
 * this constant rather than tuning it.
 */
export const MIN_PAGE_CHARACTERS = 32;

/**
 * Rasterization density handed to `pdftoppm`.
 *
 * 300 is the conventional floor for OCR accuracy: below it small type is lost,
 * and above it costs materially more CPU for very little. The fixtures render
 * at 150 deliberately — they only have to be legible to tesseract, and halving
 * the pixels halves what flows through the pipe in every test that builds one.
 */
export const OCR_DPI = 300;

/**
 * How long ONE STAGE may run before it is killed.
 *
 * **A stage, not a page, and the name says so because the ceiling it implies is
 * not the one a reader would assume.** Each page runs two subprocesses —
 * `pdftoppm` then `tesseract` — and each gets its own full budget, so the
 * worst case for a single page is twice this: **60 seconds**. The guards are
 * right; a name promising "per page" would have been the thing lying.
 *
 * Measured runs on clean 300-dpi renders land under a second. This is two
 * orders of magnitude above that, because the number that matters is
 * "obviously stuck" rather than "slower than expected on a noisy scan".
 *
 * The kill is a SIGKILL rather than a rejection, because a promise that gave up
 * while tesseract kept running leaks a process per page.
 */
export const OCR_STAGE_TIMEOUT_MS = 30_000;

/**
 * How many pages of one document may be OCR'd.
 *
 * A 200-page PDF with two scanned pages pays for two — that is the point of
 * doing this per page. This bounds the opposite case: a document that is
 * entirely images would otherwise hold a worker for minutes and, on the pipe
 * route (§3.1), push the whole file through `pdftoppm` once per page.
 *
 * Pages past the cap are not dropped. They are reported by the same §6 check
 * that reports an OCR failure, because "we stopped after fifty" and "page
 * fifty-one could not be read" are the same fact to a Knowledge Manager: part
 * of this document is not searchable.
 *
 * **This constant is what actually bounds worker occupancy, and the ceiling is
 * worth meeting here rather than in an incident.** Fifty pages at two stages
 * of `OCR_STAGE_TIMEOUT_MS` each is a worst case of **50 minutes** on one
 * worker, and nothing above bounds it — there is no BullMQ job timeout
 * configured. Real pages take under a second, so this is the pathological
 * bound rather than an expectation; lowering either number is how it comes
 * down if a queue ever backs up behind one document.
 */
export const MAX_OCR_PAGES_PER_DOCUMENT = 50;
