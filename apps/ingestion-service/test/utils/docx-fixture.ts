import JSZip from 'jszip';

/**
 * A REAL.docx, generated rather than committed
 *
 * Same reasoning as `pdf-fixture.ts`: the properties under test are that a
 * TABLE survives as a table and that OMML math survives as LaTeX, and a
 * committed binary makes both impossible to review. Here the table's cells and
 * the formula are a few lines of code beside the assertion.
 *
 * A.docx is a zip of XML parts, so this writes the three that matter:
 * `[Content_Types].xml`, `_rels/.rels` and `word/document.xml`. Word writes
 * many more; the parser reads only this one.
 */
export type DocxParts = {
  /** Paragraphs, in order. A `heading` becomes `Heading1`/`Heading2`. */
  blocks: Array<
    | { kind: 'paragraph'; text: string }
    | { kind: 'heading'; level: 1 | 2 | 3; text: string }
    | { kind: 'table'; rows: string[][] }
    /** An OMML fraction — the simplest formula that proves math survives. */
    | { kind: 'fraction'; numerator: string; denominator: string }
  >;
};

const NAMESPACES =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';

export async function buildDocx({ blocks }: DocxParts): Promise<Buffer> {
  const body = blocks.map(renderBlock).join('\n');

  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<w:document ${NAMESPACES}><w:body>${body}</w:body></w:document>`;

  const zip = new JSZip();

  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      `</Types>`,
  );

  zip
    .folder('_rels')!
    .file(
      '.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
        `</Relationships>`,
    );

  zip.folder('word')!.file('document.xml', documentXml);

  return zip.generateAsync({ type: 'nodebuffer' });
}

function renderBlock(block: DocxParts['blocks'][number]): string {
  switch (block.kind) {
    case 'heading':
      return (
        `<w:p><w:pPr><w:pStyle w:val="Heading${block.level}"/></w:pPr>` +
        `<w:r><w:t>${escapeXml(block.text)}</w:t></w:r></w:p>`
      );
    case 'paragraph':
      return `<w:p><w:r><w:t>${escapeXml(block.text)}</w:t></w:r></w:p>`;
    case 'table':
      return `<w:tbl>${block.rows.map(renderRow).join('')}</w:tbl>`;
    case 'fraction':
      return (
        `<w:p><m:oMath><m:f>` +
        `<m:num><m:r><m:t>${escapeXml(block.numerator)}</m:t></m:r></m:num>` +
        `<m:den><m:r><m:t>${escapeXml(block.denominator)}</m:t></m:r></m:den>` +
        `</m:f></m:oMath></w:p>`
      );
  }
}

function renderRow(cells: string[]): string {
  const rendered = cells
    .map(
      (cell) =>
        `<w:tc><w:p><w:r><w:t>${escapeXml(cell)}</w:t></w:r></w:p></w:tc>`,
    )
    .join('');

  return `<w:tr>${rendered}</w:tr>`;
}

function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
