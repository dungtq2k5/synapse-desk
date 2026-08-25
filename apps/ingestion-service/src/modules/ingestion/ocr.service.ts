import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  DEFAULT_OCR_LANGUAGE,
  formatErrorMsg,
  OCR_DPI,
  OCR_STAGE_TIMEOUT_MS,
  OcrLanguage,
  TESSERACT_CODE_BY_LANGUAGE,
} from '@synapsedesk/common';

/**
 * Why a page has no text after OCR.
 *
 * Carried upward, and read in two places that treat it differently.
 * `reportMissingPages` partitions its flag detail by it, so a page in the wrong
 * language and a page nobody could OCR give different advice. And
 * `binary_missing` alone decides `OcrUnavailable` over `NoExtractableText`,
 * which is the difference between blaming the file and blaming the server.
 *
 * `PageFailure` in `document-parser.service.ts` widens this by one member for
 * pages that never reached OCR at all. This type stays what it is: the outcome
 * of an ATTEMPT.
 */
export type OcrFailure =
  'timeout' | 'binary_missing' | 'engine_error' | 'no_text';

export type OcrResult =
  { ok: true; text: string } | { ok: false; reason: OcrFailure };

/**
 * `pdftoppm` then `tesseract`, per page.
 *
 * **Nothing touches the disk**. Both tools read stdin and write stdout,
 * so the PDF is piped in, the PNG never lands, and the text comes back on a
 * pipe. That is the property the offline claim now rests on: "a tenant's
 * document never leaves the deployment" reads as an empty promise if the same
 * document is sitting in `/tmp` while it is being read.
 *
 * The cost is named rather than hidden: `pdftoppm` needs the whole PDF to seek
 * to page N, so a per-page invocation re-feeds the entire file. A 50 MB PDF
 * with ten scanned pages pushes 500 MB through pipes — memory bandwidth rather
 * than I/O, bounded by `MAX_OCR_PAGES_PER_DOCUMENT`. If profiling ever says
 * otherwise, the fallback is one temp file written once and removed in
 * `finally`, and the parser's offline docblock changes with it.
 *
 * **These are C++ parsers with CVE histories reading untrusted input**, which
 * is part of what "in-process" was buying before this existed. The mitigations
 * are the per-page timeout, the page cap, and the non-root `USER node` the
 * image already runs as. Worth naming rather than discovering.
 */
@Injectable()
export class OcrService implements OnModuleInit {
  private readonly logger = new Logger(OcrService.name);

  /** Memoised by `checkAvailability`; probed once per process, at boot. */
  private available: boolean | null = null;

  /**
   * Probes at startup so a bad build is a DEPLOY-time diagnostic.
   *
   * The warning says "build ingestion-service with `--target runtime-ocr`" —
   * a message for whoever deployed the service. Delivering it lazily, on the
   * first scanned PDF days later, delivers it to the wrong person at the wrong
   * time.
   *
   * **Not awaited, and CAUGHT — both halves are the run-open rule.** OCR is a
   * capability, not a requirement, so a failing probe must not fail the boot.
   * Awaiting would turn a hung `execFile` into a service that never starts; a
   * bare `void` would be worse, since an unhandled rejection terminates the
   * process on Node 22+.
   *
   * **It deliberately does NOT reach the readiness probe.** Reporting unready
   * because a minority feature is unavailable is the boot-closed behaviour the
   * run-open rule rejects, one layer up.
   *
   * See `docs/decisions/0016-ocr-is-a-per-page-branch.md`.
   */
  onModuleInit(): void {
    this.checkAvailability().catch((error: unknown) => {
      this.logger.warn(
        `OCR availability probe failed: ${formatErrorMsg(error)}. ` +
          'Scanned pages will fail individually; nothing else is affected.',
      );
    });
  }

  /**
   * Whether both binaries exist, and it does NOT fail the boot.
   *
   * Called at boot by `onModuleInit` and again by every `recognisePage`; the
   * memoisation makes all but the first free, so the lazy call sites cost
   * nothing and the eager one decides when the warning lands.
   *
   * A missing model made the injection classifier fail its process (
   * Because that was a SECURITY control: absent, it silently stops
   * defending. This is a CAPABILITY. Absent, PDFs needing OCR fail with a named
   * reason and every other document still ingests — and failing the boot would
   * take ingestion down for every tenant because a minority feature is
   * unavailable.
   *
   * So: a loud warning once, and a named failure per document. The second half
   * is `OcrUnavailable` in `ingestion.processor.ts` — a fully scanned document
   * refuses with "OCR is not available on this deployment", and a partly
   * scanned one indexes with a `PAGES_NOT_INDEXED` flag saying the same about
   * the pages it lost. Neither tells the uploader to try another language,
   * which is what the generic no-text failure says and which cannot help here.
   */
  async checkAvailability(): Promise<boolean> {
    if (this.available !== null) return this.available;

    const run = promisify(execFile);
    const probe = (binary: string, args: string[]): Promise<boolean> =>
      run(binary, args, { timeout: 5_000 }).then(
        () => true,
        // Deliberately broad: ENOENT (absent), EACCES (present and not
        // executable) and a non-zero exit all mean the same thing here — this
        // deployment cannot OCR.
        () => false,
      );

    const [poppler, tesseract] = await Promise.all([
      probe('pdftoppm', ['-v']),
      probe('tesseract', ['--version']),
    ]);

    this.available = poppler && tesseract;

    if (!this.available) {
      this.logger.warn(
        `OCR is UNAVAILABLE — pdftoppm: ${poppler ? 'ok' : 'missing'}, ` +
          `tesseract: ${tesseract ? 'ok' : 'missing'}. Scanned PDF pages will ` +
          'fail with a named reason; every other document ingests normally. ' +
          'Build ingestion-service with `--target runtime-ocr`.',
      );
    }

    return this.available;
  }

  /**
   * The `-l` argument, from ISO 639-1 codes the uploader gave.
   *
   * **Order is preserved and the list is never sorted**, because order is the
   * one thing measured to affect accuracy: naming English first on a Vietnamese
   * document scored 2.41% character error against 0.00% the other way round.
   * The count does not matter — four languages scored identically to one — so
   * the only thing this must not do is rearrange them.
   *
   * Empty falls back to English, which is almost every document: an uploader
   * cannot know a PDF is scanned until it is parsed.
   */
  languageArgument(languages: OcrLanguage[]): string {
    const codes = languages.map((code) => TESSERACT_CODE_BY_LANGUAGE[code]);

    return codes.length > 0
      ? codes.join('+')
      : TESSERACT_CODE_BY_LANGUAGE[DEFAULT_OCR_LANGUAGE];
  }

  /**
   * One page: rasterize, recognise, return the text.
   *
   * Returns a result rather than throwing, because every caller has something
   * better to do than fail the document's whole argument is that 197 good
   * pages beat discarding all 200 to signal three.
   */
  async recognisePage(
    pdf: Buffer,
    pageNumber: number,
    languages: OcrLanguage[],
  ): Promise<OcrResult> {
    if (!(await this.checkAvailability())) {
      return { ok: false, reason: 'binary_missing' };
    }

    try {
      const png = await this.pipe(
        'pdftoppm',
        [
          '-f',
          String(pageNumber),
          '-l',
          String(pageNumber),
          '-r',
          String(OCR_DPI),
          '-png',
          // stdin. The whole point of piping.
          '-',
        ],
        pdf,
      );

      const text = await this.pipe(
        'tesseract',
        ['stdin', 'stdout', '-l', this.languageArgument(languages)],
        png,
      );

      const recognized = text.toString('utf8').trim();

      return recognized.length > 0
        ? { ok: true, text: recognized }
        : { ok: false, reason: 'no_text' };
    } catch (error) {
      const reason: OcrFailure =
        error instanceof OcrTimeout ? 'timeout' : 'engine_error';

      // The page number is safe to log; the page CONTENT is not, and never
      // reaches here as a log argument — same rule as `error_log`.
      this.logger.warn(`OCR failed on page ${pageNumber}: ${reason}`);

      return { ok: false, reason };
    }
  }

  /**
   * Runs a binary with `input` on stdin and returns stdout.
   *
   * **`spawn`, never `exec`.** No shell means an argument can never become a
   * command; there is no filename in these arguments today, and the guarantee
   * is what keeps that true when somebody adds one.
   *
   * **Not `execFile` either, and this cost an afternoon once:** the async form
   * has no `input` option — that belongs to `execFileSync` — so passing one
   * spawns the child against a stdin nothing ever writes or closes, and the
   * call hangs rather than failing. stdin is written explicitly here.
   *
   * The timeout kills the child rather than merely rejecting: a promise that
   * gave up while `tesseract` kept running would leak a process per page.
   */
  private pipe(binary: string, args: string[], input: Buffer): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const child = spawn(binary, args, { stdio: ['pipe', 'pipe', 'pipe'] });

      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let settled = false;

      const timer = setTimeout(() => {
        settled = true;
        child.kill('SIGKILL');
        reject(new OcrTimeout(binary));
      }, OCR_STAGE_TIMEOUT_MS);

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill('SIGKILL');
        reject(error);
      };

      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

      // ENOENT lands here rather than on `close` — a binary that does not
      // exist never runs to have an exit code.
      child.on('error', fail);
      // EPIPE when the child died before reading its input. Already reported
      // by `error` or a non-zero `close`, so this only stops an unhandled
      // rejection from taking the worker with it.
      child.stdin.on('error', () => undefined);

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        if (code === 0) {
          resolve(Buffer.concat(stdout));

          return;
        }

        reject(
          new Error(
            `${binary} exited ${code}: ${Buffer.concat(stderr)
              .toString('utf8')
              .slice(0, 200)}`,
          ),
        );
      });

      child.stdin.end(input);
    });
  }
}

/** Distinguished so a timed-out page reports as such rather than as an error. */
export class OcrTimeout extends Error {
  constructor(binary: string) {
    super(`${binary} exceeded ${OCR_STAGE_TIMEOUT_MS}ms`);
  }
}

/** Re-exported so the parser reads one name rather than a config import. */
export { MAX_OCR_PAGES_PER_DOCUMENT as MAX_OCR_PAGES } from '@synapsedesk/common';
