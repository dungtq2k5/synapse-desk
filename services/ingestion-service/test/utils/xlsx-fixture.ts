import ExcelJS from 'exceljs';

/** One sheet: a name and its rows, header row first. */
export type SheetSpec = {
  name: string;
  /** `null` writes a BLANK cell — the gap case, which shifts columns if read wrong. */
  rows: (string | number | Date | null)[][];
};

/**
 * A REAL `.xlsx`, written by exceljs and read back by the parser's streaming
 * reader.
 *
 * Generated rather than committed for the reason `buildPdf` gives: the property
 * under test is sheet and row ATTRIBUTION, and a committed binary makes that
 * impossible to read in a review — nobody can tell what sheet 2 is supposed to
 * say by looking at the diff. Here each sheet's content is a line of code beside
 * the assertion.
 *
 * The same library writes and reads, which is a weaker guarantee than the PDF
 * fixture's two-library round trip. It is the right trade here: what is under
 * test is this repo's markdown shaping and its two caps, not exceljs's own
 * OOXML conformance.
 */
export async function buildXlsx(sheets: SheetSpec[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name);
    for (const row of sheet.rows) worksheet.addRow(row);
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/**
 * One sheet with `count` data rows under a fixed header.
 *
 * For the ROW cap specifically — the cell values are `row-1`, `row-2`, … so an
 * assertion can name exactly which row survived and which did not.
 */
export function tallSheet(name: string, count: number): SheetSpec {
  return {
    name,
    rows: [
      ['Region', 'Actual', 'Plan'],
      ...Array.from({ length: count }, (_, index) => [
        `row-${index + 1}`,
        index + 1,
        (index + 1) * 2,
      ]),
    ],
  };
}
