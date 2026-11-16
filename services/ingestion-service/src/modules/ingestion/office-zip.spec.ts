import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import {
  MAX_OFFICE_DECOMPRESSED_BYTES,
  MAX_OFFICE_ENTRIES,
  type ParseEligibleMimeType,
} from '@synapsedesk/contracts';
import { buildDocx } from '../../../test/utils/docx-fixture';
import { buildXlsx } from '../../../test/utils/xlsx-fixture';
import {
  deflateRepeated,
  zipOf,
  type DeflatedEntry,
} from '../../../test/utils/zip-bomb';
import { AttachmentExtractorService } from './attachment-extractor.service';
import { DocumentParserService } from './document-parser.service';
import { OcrService } from './ocr.service';
import { assertOfficeZipFits, OfficeFileTooLarge } from './office-zip';
import type { StorageReferenceService } from '../storage-client/storage-reference.service';

/**
 * Known gap 17: an Office file's unzipped size, bounded before a parser
 * inflates it. The bombs here are a few hundred KB that inflate past
 * `MAX_OFFICE_DECOMPRESSED_BYTES`.
 */
describe('An Office zip that inflates past the ceiling', () => {
  const DOCX =
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document' satisfies ParseEligibleMimeType;
  const XLSX =
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' satisfies ParseEligibleMimeType;

  /** Repetitive XML, 1 MiB at a time, past the ceiling by 16 MiB. */
  let bomb: DeflatedEntry;

  beforeAll(async () => {
    const paragraph = Buffer.from('<w:p><w:r><w:t>x</w:t></w:r></w:p>');
    const chunk = Buffer.concat(
      Array.from(
        { length: Math.ceil((1024 * 1024) / paragraph.length) },
        () => paragraph,
      ),
    );
    bomb = await deflateRepeated(
      chunk,
      Math.ceil(MAX_OFFICE_DECOMPRESSED_BYTES / chunk.length) + 16,
    );
  }, 60_000);

  const docxBomb = (declaredSize?: number) =>
    zipOf([{ name: 'word/document.xml', entry: bomb, declaredSize }]);
  const xlsxBomb = () =>
    zipOf([{ name: 'xl/worksheets/sheet1.xml', entry: bomb }]);

  const extractor = (bytes: Buffer) =>
    new AttachmentExtractorService(
      new DocumentParserService(new OcrService()),
      {
        downloadObject: jest.fn().mockResolvedValue(bytes),
      } as unknown as StorageReferenceService,
    );

  const refusalOf = async (bytes: Buffer, mimeType: string) => {
    const error = await extractor(bytes)
      .extract('organizations/o/m/f', mimeType, 'org-1')
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );
    expect(error).toBeInstanceOf(RpcException);
    return (error as RpcException).getError() as {
      code: number;
      message: string;
    };
  };

  it('the bomb is small, and inflates past the ceiling', () => {
    expect(docxBomb().length).toBeLessThan(2 * 1024 * 1024);
    expect(bomb.inflatedSize).toBeGreaterThan(MAX_OFFICE_DECOMPRESSED_BYTES);
  });

  it('1. **a .docx bomb is refused before the parser opens it**', async () => {
    await expect(assertOfficeZipFits(docxBomb())).rejects.toBeInstanceOf(
      OfficeFileTooLarge,
    );
  }, 60_000);

  it('2. **…even when its headers say it is small**', async () => {
    // A zip's declared sizes are the maker's word. Counted as it inflates.
    await expect(assertOfficeZipFits(docxBomb(1000))).rejects.toBeInstanceOf(
      OfficeFileTooLarge,
    );
  }, 60_000);

  it('3. **as an attachment, .docx and .xlsx answer INVALID_ARGUMENT**', async () => {
    // Permanent, so the hourly retry logs it once and never re-inflates it.
    for (const [bytes, mimeType] of [
      [docxBomb(), DOCX],
      [xlsxBomb(), XLSX],
    ] as const) {
      const refusal = await refusalOf(bytes, mimeType);
      expect(refusal.code).toBe(status.INVALID_ARGUMENT);
      expect(refusal.message).toMatch(/expands to more than 256 MB/);
    }
  }, 120_000);

  it(`4. more than ${MAX_OFFICE_ENTRIES} files inside is refused`, async () => {
    const empty = await deflateRepeated(Buffer.from(''), 1);
    const many = zipOf(
      Array.from({ length: MAX_OFFICE_ENTRIES + 1 }, (_, index) => ({
        name: `word/part${index}.xml`,
        entry: empty,
      })),
    );

    await expect(assertOfficeZipFits(many)).rejects.toBeInstanceOf(
      OfficeFileTooLarge,
    );
  });

  it('5. real files pass: the seed .docx and generated .docx and .xlsx', async () => {
    const seed = readFileSync(
      join(
        __dirname,
        '../../../../../scripts/seed-demo/fixtures/new-starter-guide.docx',
      ),
    );
    const docx = await buildDocx({
      blocks: [{ kind: 'paragraph', text: 'Standing desks ship in a week.' }],
    });
    const xlsx = await buildXlsx([
      {
        name: 'Orders',
        rows: [
          ['SKU', 'Qty'],
          ['DESK-1', 2],
        ],
      },
    ]);

    for (const bytes of [seed, docx, xlsx]) {
      await expect(assertOfficeZipFits(bytes)).resolves.toBeUndefined();
    }
  });

  it('6. a corrupt zip passes the check, and the parser refuses it as before', async () => {
    const corrupt = Buffer.from('PK\u0003\u0004 not really a zip');

    await expect(assertOfficeZipFits(corrupt)).resolves.toBeUndefined();
    const refusal = await refusalOf(corrupt, DOCX);
    expect(refusal.code).toBe(status.INTERNAL);
  });
});
