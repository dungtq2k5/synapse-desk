import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENT_BYTES,
} from '@synapsedesk/common';
import { UploadAttachmentDto } from './message.dto';

/**
 * The attachment guard, tested where it is CHEAPEST — §2.5 test 7.
 *
 * `storage-service` will check the same two things against its own
 * `PURPOSE_POLICY` (10-storage-service.md §2.2). That is not duplication for
 * its own sake: this layer refuses a 2 GB request before it costs a network
 * hop, and that layer holds no matter which service is asking. Neither can be
 * dropped because the other exists — so both need a test, and this one needs no
 * HTTP server to run.
 */
describe('UploadAttachmentDto (unit)', () => {
  const validate = (payload: Record<string, unknown>) =>
    validateSync(plainToInstance(UploadAttachmentDto, payload), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

  const valid = {
    fileName: 'screenshot.png',
    mimeType: 'image/png',
    fileSizeBytes: 2048,
  };

  const failedProperties = (payload: Record<string, unknown>) =>
    validate(payload).map((error) => error.property);

  it('accepts a well-formed upload', () => {
    expect(validate(valid)).toHaveLength(0);
  });

  it('accepts EVERY type on the allowlist', () => {
    // Catches an entry that is present but unusable — a trailing space or a
    // mismatched case in the constant would make a legitimate file type
    // permanently un-uploadable, and nobody would look at the allowlist to
    // explain it.
    for (const mimeType of ALLOWED_ATTACHMENT_MIME_TYPES) {
      expect([mimeType, validate({ ...valid, mimeType })]).toEqual([
        mimeType,
        [],
      ]);
    }
  });

  it('REFUSES a type that is not on the allowlist', () => {
    // An allowlist, never a denylist. A denylist is a promise to have thought
    // of every dangerous type, and that is not a promise anyone can keep.
    expect(
      failedProperties({ ...valid, mimeType: 'application/x-httpd-php' }),
    ).toContain('mimeType');
  });

  it('REFUSES an executable disguised by its file NAME', () => {
    // The name is decoration; the mime type is what is checked. A `.png` name
    // over an executable mime type must fail on the type — which is also why
    // the eventual object path derives its extension from the mime type rather
    // than from this field.
    expect(
      failedProperties({
        ...valid,
        fileName: 'totally-a-picture.png',
        mimeType: 'application/x-msdownload',
      }),
    ).toContain('mimeType');
  });

  it('REFUSES a file over the size cap', () => {
    expect(
      failedProperties({ ...valid, fileSizeBytes: MAX_ATTACHMENT_BYTES + 1 }),
    ).toContain('fileSizeBytes');
  });

  it('ACCEPTS a file exactly at the cap', () => {
    // The boundary, stated. Off-by-one here rejects a legal file and nobody
    // notices until a user with a 10 MB PDF complains.
    expect(
      validate({ ...valid, fileSizeBytes: MAX_ATTACHMENT_BYTES }),
    ).toHaveLength(0);
  });

  it('REFUSES a zero-byte and a negative size', () => {
    expect(failedProperties({ ...valid, fileSizeBytes: 0 })).toContain(
      'fileSizeBytes',
    );
    expect(failedProperties({ ...valid, fileSizeBytes: -1 })).toContain(
      'fileSizeBytes',
    );
  });

  it('REFUSES a non-numeric size rather than coercing it to NaN', () => {
    // `@Type(() => Number)` turns 'big' into NaN, which would slip past a bare
    // `@Min(1)` in some versions and reach the service as a nonsense number.
    expect(failedProperties({ ...valid, fileSizeBytes: 'big' })).toContain(
      'fileSizeBytes',
    );
  });

  it('REFUSES a missing fileName and an over-long one', () => {
    expect(
      failedProperties({ mimeType: 'image/png', fileSizeBytes: 1 }),
    ).toContain('fileName');
    expect(failedProperties({ ...valid, fileName: 'a'.repeat(256) })).toContain(
      'fileName',
    );
  });

  it('TRIMS the file name rather than storing the padding', () => {
    const dto = plainToInstance(UploadAttachmentDto, {
      ...valid,
      fileName: '  report.pdf  ',
    });

    expect(dto.fileName).toBe('report.pdf');
  });
});
