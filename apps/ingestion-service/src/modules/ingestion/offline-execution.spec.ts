import { buildDocx } from '../../../test/utils/docx-fixture';
import { buildPdf, buildScannedPdf } from '../../../test/utils/pdf-fixture';
import { describeWithOcr } from '../../../test/utils/ocr-binaries';

/**
 * **Which binaries this service is allowed to run**
 *
 * Its own file because of how the observation has to be made. `jest.spyOn`
 * cannot patch `node:child_process` — its exports are non-configurable, and
 * `Cannot redefine property: spawn` is what you get for trying — so the module
 * is mocked at load, which `jest.mock` hoists above every import in the file.
 * Doing that inside `document-parser.service.spec.ts` would apply it to sixteen
 * tests that have nothing to do with subprocesses.
 *
 * **The mock DELEGATES to the real implementation.** `jest.fn(actual.spawn)`
 * records the call and then performs it, so these run the real `pdftoppm` and
 * the real `tesseract` and assert on what was asked for. A stubbed child would
 * have asserted that our code intends to call two binaries, which is a much
 * weaker statement than that it calls exactly those two and gets text back.
 *
 * Without this file, "no system binary" simply stops being true and nothing
 * notices the next shell-out — which is the whole reason §2 asks for it rather
 * than merely relaxing the claim.
 */
jest.mock('node:child_process', () => {
  const actual =
    jest.requireActual<typeof import('node:child_process')>(
      'node:child_process',
    );

  return {
    ...actual,
    spawn: jest.fn(actual.spawn),
    execFile: jest.fn(actual.execFile),
  };
});

import { spawn, execFile } from 'node:child_process';

/**
 * The mocked forms, typed once.
 *
 * `spawn` is overloaded, so a direct cast to `jest.Mock` is rejected as
 * non-overlapping — `unknown` first is the documented way through, and doing it
 * here keeps four call sites from repeating the incantation.
 */
const spawnMock = spawn as unknown as jest.Mock;
const execFileMock = execFile as unknown as jest.Mock;
import { DocumentParserService } from './document-parser.service';
import { OcrService } from './ocr.service';

describe('§2 the only subprocesses are the OCR pair', () => {
  const parser = new DocumentParserService(new OcrService());

  const parse = async (bytes: Buffer, type: string) =>
    (await parser.parse(bytes, type)).pages;

  beforeEach(() => {
    spawnMock.mockClear();
    execFileMock.mockClear();
  });

  it('**no format but a scanned PDF spawns anything at all**', async () => {
    // The common path is every document that is not scanned, and OCR on it
    // would be pure cost. Both APIs are watched: `spawn` is how OCR runs and
    // `execFile` is how it probes for its binaries, so a test watching one
    // would pass while the other quietly grew a caller.
    await parse(
      await buildDocx({
        blocks: [{ kind: 'paragraph', text: 'No subprocess for this.' }],
      }),
      'docx',
    );
    await parse(Buffer.from('plain text, no subprocess either'), 'txt');
    await parse(await buildPdf(['A born-digital page']), 'pdf');

    expect(spawnMock).not.toHaveBeenCalled();
    expect(execFileMock).not.toHaveBeenCalled();
  }, 60_000);

  describeWithOcr('and a scanned PDF spawns ONLY that pair', () => {
    it('**`pdftoppm` and `tesseract`, and nothing else**', async () => {
      // The allowed set, named. A third binary appearing here has to be a
      // decision somebody makes deliberately rather than a line that slipped
      // into a diff.
      const pages = await parse(
        await buildScannedPdf(['SCANNED APPENDIX']),
        'pdf',
      );

      const binaries = [
        ...new Set(spawnMock.mock.calls.map(([b]) => String(b))),
      ].sort();

      expect(binaries).toEqual(['pdftoppm', 'tesseract']);
      // And it really ran: asserting the argv of a call that produced nothing
      // would pass just as well if OCR were broken.
      expect(pages[0].markdown).toMatch(/SCANNED/i);
    }, 120_000);

    it('and the OCR pair runs with NO shell', async () => {
      // `spawn` without a `shell` option is what makes an argument incapable of
      // becoming a command. There is no filename in these arguments today; the
      // guarantee is what keeps that safe when somebody adds one.
      await parse(await buildScannedPdf(['SCANNED APPENDIX']), 'pdf');

      for (const [, , options] of spawnMock.mock.calls) {
        expect(options?.shell).toBeFalsy();
      }
    }, 120_000);
  });
});

describe('§6.1 the availability probe', () => {
  it('**runs once per process, not once per page**', async () => {
    // A fifty-page scanned document must not fork a hundred probes, and on a
    // deployment WITHOUT the binaries it must not print the same warning fifty
    // times — that is how the one line that matters goes unread.
    //
    // Asserted here rather than in `ocr.spec.ts` because this is the file where
    // `execFile` is observable: emptying PATH does not work, since Linux
    // `execvp` falls back to a default path and finds the binaries anyway.
    const ocr = new OcrService();

    await ocr.checkAvailability();
    await ocr.checkAvailability();
    await ocr.checkAvailability();

    // Two probes total — one per binary — however many times it is asked.
    expect(execFileMock).toHaveBeenCalledTimes(2);
    expect(
      execFileMock.mock.calls.map(([binary]) => String(binary)).sort(),
    ).toEqual(['pdftoppm', 'tesseract']);
  }, 30_000);
});

describe('§6.1 the probe runs at BOOT, not at first use', () => {
  it('**module init probes, before any document is processed**', async () => {
    // The warning says "build with `--target runtime-ocr`" — a message for
    // whoever deployed the service. Probing lazily delivers it on the first
    // scanned PDF, which could be days later, to whoever happens to be reading
    // logs then.
    const ocr = new OcrService();
    // Cleared here rather than in a `beforeEach`: the suites above share this
    // module-level mock, and a count assertion that inherited their calls
    // would pass or fail on test ordering.
    execFileMock.mockClear();

    ocr.onModuleInit();
    // `void`-dispatched, so let the microtask and the two probes settle.
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(execFileMock).toHaveBeenCalledTimes(2);
    expect(
      execFileMock.mock.calls.map(([binary]) => String(binary)).sort(),
    ).toEqual(['pdftoppm', 'tesseract']);
  }, 30_000);

  it('**a failing probe does not fail boot** — §6.1 is not boot-closed', () => {
    // The rule this fix must not accidentally invert. OCR is a capability: a
    // deployment without the binaries still ingests every other document, so
    // the hook returns void and swallows nothing it should have thrown.
    const ocr = new OcrService();
    jest
      .spyOn(ocr, 'checkAvailability')
      .mockRejectedValue(new Error('probe exploded'));

    expect(() => ocr.onModuleInit()).not.toThrow();
  });
});
