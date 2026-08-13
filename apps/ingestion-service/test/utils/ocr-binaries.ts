import { execFileSync } from 'node:child_process';

/**
 * Whether the OCR binaries are installed on THIS machine — 34-doc §3.4.
 *
 * **Jest runs on the developer's host, not in the image.** `runtime-ocr` puts
 * poppler and tesseract where the service runs; it puts them nowhere jest can
 * reach. So a suite that needs the real binaries has to ask, and the answer is
 * a property of the machine rather than of the code under test.
 *
 * **Skip with a reason, never fail.** A red suite nobody can fix locally gets
 * deleted or `--testPathIgnorePatterns`'d within a fortnight; a visibly skipped
 * test naming the package gets the package installed. That is the whole
 * argument, and it is why this returns a boolean rather than throwing.
 *
 *     apt-get install -y poppler-utils tesseract-ocr tesseract-ocr-eng
 *
 * Checked once per process: `execFileSync` costs a fork, and doing it per test
 * would put a hundred of them in a suite that mostly does not care.
 */
function probe(binary: string, args: string[]): boolean {
  try {
    execFileSync(binary, args, { stdio: 'ignore' });

    return true;
  } catch {
    // Deliberately broad: ENOENT (not installed), EACCES (installed and not
    // executable) and a non-zero exit all mean the same thing to a caller —
    // this machine cannot run the test.
    return false;
  }
}

/** poppler's rasteriser. Also required by the mixed-page FIXTURE — §8.1. */
export const HAS_POPPLER = probe('pdftoppm', ['-v']);

/** The OCR engine itself. */
export const HAS_TESSERACT = probe('tesseract', ['--version']);

export const HAS_OCR_BINARIES = HAS_POPPLER && HAS_TESSERACT;

/**
 * The sentence a skipped test prints, naming what to install and why.
 *
 * Written out in full rather than "missing binaries" because the reader is
 * someone who just watched a test skip and has thirty seconds of curiosity.
 */
export const OCR_SKIP_REASON =
  'requires poppler-utils + tesseract-ocr on the host — ' +
  'apt-get install -y poppler-utils tesseract-ocr tesseract-ocr-eng ' +
  '(see apps/ingestion-service/README.md)';

/**
 * `describe` that skips when the binaries are absent — 34-doc §3.4.
 *
 * Used instead of a bare `describe.skip` so the reason travels with the skip:
 * jest prints the suite name, and a name ending in the install command is the
 * difference between a developer installing tesseract and a developer assuming
 * the suite is broken.
 */
export const describeWithOcr = HAS_OCR_BINARIES
  ? describe
  : describe.skip.bind(describe);

/** The same, for suites that only rasterise — the fixture needs poppler alone. */
export const describeWithPoppler = HAS_POPPLER
  ? describe
  : describe.skip.bind(describe);
