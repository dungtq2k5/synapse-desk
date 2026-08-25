import ExcelJS from 'exceljs';
import { MAX_EXTRACTED_TEXT_CHARS, MAX_SHEET_ROWS } from '@synapsedesk/common';
import { DocumentParserService } from './document-parser.service';
import { OcrService } from './ocr.service';
import { buildXlsx, tallSheet } from '../../../test/utils/xlsx-fixture';

/**
 * Workbook to markdown.
 *
 * A UNIT spec against real bytes: `parseXlsx` needs no database, no storage and
 * no tenant, and the two caps it enforces are the kind of arithmetic that is
 * cheapest to pin here. The e2e half — that an `.xlsx` reaches the model as text
 * and that a corrupt one stores NULL — lives with the rest of the attachment
 * pipeline.
 */
describe('Spreadsheet extraction (unit)', () => {
  const parser = new DocumentParserService(new OcrService());

  const parse = async (bytes: Buffer): Promise<string[]> => {
    const parsed = await parser.parse(bytes, 'xlsx');

    return parsed.pages.map((page) => page.markdown);
  };

  it('1. **every sheet arrives, each under its own heading**', async () => {
    // The join in `AttachmentExtractorService` does no format-specific work, so
    // the heading has to come from here or the sheets run together into one
    // undifferentiated table and the model cannot tell which figure came from
    // which sheet.
    const bytes = await buildXlsx([
      {
        name: 'Q1 Revenue',
        rows: [
          ['Region', 'Actual'],
          ['APAC', 1240],
        ],
      },
      { name: 'Notes', rows: [['Note'], ['second sheet present']] },
    ]);

    const pages = await parse(bytes);

    expect(pages).toHaveLength(2);
    expect(pages[0]).toContain('## Sheet: Q1 Revenue');
    expect(pages[1]).toContain('## Sheet: Notes');
    expect(pages[1]).toContain('second sheet present');
  });

  it('**1b. and the sheets keep their ORDER**', async () => {
    // A workbook's sheet order is authored, and a citation-free extraction is
    // read top to bottom — "the first table" has to mean the first sheet.
    const bytes = await buildXlsx([
      { name: 'First', rows: [['a'], ['1']] },
      { name: 'Second', rows: [['b'], ['2']] },
      { name: 'Third', rows: [['c'], ['3']] },
    ]);

    const pages = await parse(bytes);

    expect(pages.map((page) => page.split('\n')[0])).toEqual([
      '## Sheet: First',
      '## Sheet: Second',
      '## Sheet: Third',
    ]);
  });

  it('**3b. the header row has NO leading empty column**', async () => {
    // `row.values` is 1-INDEXED: exceljs returns `[null, 'Region', …]` because
    // spreadsheet columns are 1-based.
    //
    // **This looks cosmetic and is not.** `values.join(' | ')` produces
    // `|  | Region | Actual | Plan |`, which is a VALID markdown table — it
    // renders, it passes every eyeball check, and it passes any assertion that
    // only counts rows. The model then reads a column that does not exist, in
    // every row of every sheet, and nothing anywhere reports it.
    const bytes = await buildXlsx([
      {
        name: 'S',
        rows: [
          ['Region', 'Actual', 'Plan'],
          ['APAC', 1240, 1100],
        ],
      },
    ]);

    const [markdown] = await parse(bytes);
    const lines = markdown.split('\n').filter((line) => line.startsWith('|'));

    expect(lines[0]).toBe('| Region | Actual | Plan |');
    expect(lines[1]).toBe('| --- | --- | --- |');
    expect(lines[2]).toBe('| APAC | 1240 | 1100 |');
  });

  it('**3c. …and the GFM delimiter row is present, or it is not a table at all**', async () => {
    // Without the delimiter the block is paragraph text. The same failure
    // `markFirstTableRowAsHeader` exists to prevent on the DOCX path, arrived at
    // from the other direction.
    const bytes = await buildXlsx([
      {
        name: 'S',
        rows: [
          ['A', 'B'],
          ['1', '2'],
        ],
      },
    ]);

    const [markdown] = await parse(bytes);

    expect(markdown).toContain('| --- | --- |');
  });

  it('2. **a sheet past the row cap is cut AND says so**', async () => {
    // The marker is for the MODEL. A table that simply stops is
    // indistinguishable from one that ended, and it will answer confidently
    // from the part it can see.
    const bytes = await buildXlsx([tallSheet('Big', MAX_SHEET_ROWS + 200)]);

    const [markdown] = await parse(bytes);
    const rows = markdown
      .split('\n')
      .filter((line) => line.startsWith('| row-'));

    // The header consumes one of the capped rows, so 499 data rows survive.
    expect(rows).toHaveLength(MAX_SHEET_ROWS - 1);
    expect(markdown).toContain(`row-${MAX_SHEET_ROWS - 1}`);
    expect(markdown).not.toContain(`| row-${MAX_SHEET_ROWS} |`);
    // The REAL height, not the capped one. Reporting "500 of 500" would be a
    // truncation notice saying nothing was truncated.
    expect(markdown).toContain(
      `of ${(MAX_SHEET_ROWS + 201).toLocaleString('en-US')} rows shown`,
    );
  });

  it('**2b. and a sheet INSIDE the cap carries no marker at all**', async () => {
    // The other half. Test 2 alone stays green for an implementation that
    // stamps the marker unconditionally, which would tell the model that every
    // spreadsheet it ever sees is incomplete.
    const bytes = await buildXlsx([tallSheet('Small', 10)]);

    const [markdown] = await parse(bytes);

    expect(markdown).not.toContain('Truncated');
  });

  it('3. **the streaming reader is NOT used, and this pins why**', async () => {
    // Doc 57 §2 chose exceljs for `ExcelJS.stream.xlsx.WorkbookReader`: an
    // early exit at `MAX_SHEET_ROWS`, so row 501 is never built. The original
    // test 3 asserted exactly that.
    //
    // **Measured against 4.4.0, the streaming reader crashes on multi-sheet
    // workbooks** — 103 failures in 200 runs on three sheets, 0 in 60 on one —
    // with `TypeError: Cannot read properties of undefined (reading 'sheets')`
    // at `workbook-reader.js:303`, under every option combination it accepts.
    // `load()` over the same bytes: 200 runs, 0 crashes.
    //
    // So the cap is a post-hoc slice now, and this test replaces the one that
    // said otherwise rather than leaving a green assertion about a property the
    // code no longer has. What it pins is the CONSEQUENCE that survives: every
    // row is materialized, and the cap still holds.
    //
    // **There is deliberately no test asserting that exceljs still crashes.**
    // One was written and removed: the crash is a RACE, so a test for it is
    // nondeterministic by construction — it went green twice in eight runs,
    // which is a flaky test introduced while fixing a flaky test, and this repo
    // has three known-gaps rows about what that teaches a team. Re-measuring on
    // an exceljs upgrade is a manual step; `parseXlsx`'s docblock carries the
    // numbers and the `workbook-reader.js:303` line to check.
    const total = 3_000;
    const bytes = await buildXlsx([tallSheet('Huge', total)]);

    const [markdown] = await parse(bytes);
    const rows = markdown
      .split('\n')
      .filter((line) => line.startsWith('| row-'));

    expect(rows).toHaveLength(MAX_SHEET_ROWS - 1);
    // The marker names the REAL height, which is only knowable because every
    // row was counted — the honest signature of a post-hoc cap.
    expect(markdown).toContain(
      `of ${(total + 1).toLocaleString('en-US')} rows shown`,
    );
  });

  it('**3a. a CAPPED sheet does not swallow the sheets after it**', async () => {
    // §4's "every sheet is represented", which is the property the row cap is
    // most likely to break: stop iterating at the cap in the wrong place and
    // the workbook ends there, leaving one truncated sheet and nothing else —
    // strictly worse than reading everything.
    //
    // Through the real parser, so it pins OUR loop: a `return` instead of the
    // per-sheet counter would go red here and nowhere else.
    const bytes = await buildXlsx([
      tallSheet('Huge', MAX_SHEET_ROWS + 500),
      { name: 'Afterwards', rows: [['Note'], ['still here']] },
    ]);

    const pages = await parse(bytes);

    expect(pages).toHaveLength(2);
    expect(pages[1]).toContain('## Sheet: Afterwards');
    expect(pages[1]).toContain('still here');
  });

  it('**a formula cell extracts its RESULT, never its formula**', async () => {
    // exceljs returns an object carrying both. The result is what a reader
    // wants and what the model can use; `=SUM(B2:B3)` is noise in a table cell.
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Calc');
    sheet.addRow(['Label', 'Value']);
    const row = sheet.addRow(['Total', null]);
    row.getCell(2).value = { formula: 'SUM(B1:B1)', result: 42 };
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());

    const [markdown] = await parser
      .parse(bytes, 'xlsx')
      .then((parsed) => parsed.pages.map((page) => page.markdown));

    expect(markdown).toContain('| Total | 42 |');
    expect(markdown).not.toContain('SUM');
  });

  it('**4. a RICH TEXT cell extracts its text, not an empty column**', async () => {
    // The live defect this hardening pass exists for. `row.values` hands back
    // `{ richText: [...] }` for any cell with mixed inline formatting — no
    // `text`, no `result`, not a `Date` — and the hand-rolled formatter returned
    // `''` for it.
    //
    // **Invisible by construction.** Rich text is routinely the header row, the
    // markdown still renders as a valid table, and the column count is
    // unchanged — so the phantom-column test cannot see it either. The only
    // symptom is a blank column the model reads as absent data.
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('S');
    sheet.addRow(['plain', 'header']);
    const row = sheet.addRow(['rich', null]);
    row.getCell(2).value = {
      richText: [{ text: 'BOLD' }, { text: ' tail' }],
    };
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());

    const [markdown] = await parse(bytes);

    expect(markdown).toContain('| rich | BOLD tail |');
  });

  it('**5. an ERROR cell extracts `#DIV/0!` rather than nothing**', async () => {
    // Decided rather than silent. A broken formula is information — it says the
    // spreadsheet itself is wrong — and rendering it as an empty cell hides
    // that from the one reader who might mention it in an answer.
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('S');
    sheet.addRow(['label', 'value']);
    const row = sheet.addRow(['broken', null]);
    row.getCell(2).value = { error: '#DIV/0!' };
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());

    const [markdown] = await parse(bytes);

    expect(markdown).toContain('| broken | #DIV/0! |');
  });

  it('**7. a DATE renders as a fixed ISO string, not the host timezone**', async () => {
    // `cell.text` on a date goes through the host's locale and timezone —
    // measured as `Mon Mar 02 2026 07:00:00 GMT+0700 (Indochina Time)` — so the
    // same workbook would extract differently on two machines, and a stored
    // extraction would depend on which worker happened to parse it.
    //
    // **The assertion is on the exact string, not on a pattern**, because a
    // pattern loose enough to accept both forms accepts the bug.
    const bytes = await buildXlsx([
      {
        name: 'S',
        rows: [
          ['label', 'when'],
          ['invoice', new Date('2026-03-02T00:00:00.000Z')],
        ],
      },
    ]);

    const [markdown] = await parse(bytes);

    expect(markdown).toContain('| invoice | 2026-03-02T00:00:00.000Z |');
    // Nothing locale-shaped survived: no weekday name, no offset.
    expect(markdown).not.toMatch(/GMT|Mon |Tue |Wed /);
  });

  it('**6. a BLANK middle column keeps every column after it in place**', async () => {
    // Written BEFORE the rich-text fix, and that is the point: it passes on
    // `row.values.slice(1)`, which is column-correct, and fails the moment a
    // bare `row.eachCell` replaces it — because `eachCell` SKIPS empty cells and
    // yields two values against a three-column header.
    //
    // Same bug class as the phantom leading column and the unescaped pipe,
    // arriving from a third direction: the table still parses, one row silently
    // disagrees with its header, and the model reads `right` as B.
    const bytes = await buildXlsx([
      {
        name: 'S',
        rows: [
          ['A', 'B', 'C'],
          ['left', null, 'right'],
        ],
      },
    ]);

    const [markdown] = await parse(bytes);
    const data = markdown
      .split('\n')
      .filter((line) => line.startsWith('|'))
      .at(-1);

    expect(data).toBe('| left |  | right |');
  });

  it('**a pipe inside a cell does not shift the columns after it**', async () => {
    // An unescaped `|` ends the cell early and moves every column after it, for
    // that row only — so the table still parses and one row silently disagrees
    // with the header.
    const bytes = await buildXlsx([
      {
        name: 'S',
        rows: [
          ['A', 'B'],
          ['left | right', 'kept'],
        ],
      },
    ]);

    const [markdown] = await parse(bytes);
    const data = markdown
      .split('\n')
      .filter((line) => line.startsWith('|'))
      .at(-1);

    expect(data).toBe('| left \\| right | kept |');
  });

  it('**an empty workbook parses to no pages rather than to an empty table**', async () => {
    // `''` means "a parser ran and the file had no text", which doc 56 §B1
    // keeps distinct from NULL. A sheet with no rows must not become a heading
    // over an empty table — that reads as content.
    const bytes = await buildXlsx([{ name: 'Blank', rows: [] }]);

    const pages = await parse(bytes);

    expect(pages).toEqual([]);
  });

  it('**a workbook has no PAGES, so nothing can be reported missing**', async () => {
    // `pageCount: 0` is what makes `reportMissingPages` return early. A sheet is
    // not a page that could go missing, and counting sheets there would flag
    // every workbook as incomplete.
    const parsed = await parser.parse(
      await buildXlsx([{ name: 'S', rows: [['a'], ['1']] }]),
      'xlsx',
    );

    expect(parsed.pageCount).toBe(0);
    expect(parsed.failedPages).toEqual([]);
  });

  it('**the row cap alone cannot exceed the CHARACTER budget for one sheet**', async () => {
    // Sanity on the two caps together: 500 rows of ordinary width sit far
    // inside the character budget, which is what makes tests 2 and 4 separable
    // — a fixture that tripped both would prove neither.
    const bytes = await buildXlsx([tallSheet('Big', MAX_SHEET_ROWS + 50)]);

    const [markdown] = await parse(bytes);

    expect(markdown.length).toBeLessThan(MAX_EXTRACTED_TEXT_CHARS);
  });
});
