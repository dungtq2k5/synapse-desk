import {
  MAX_OFFICE_DECOMPRESSED_BYTES,
  MAX_OFFICE_ENTRIES,
} from '@synapsedesk/contracts';
import JSZip from 'jszip';

/**
 * An Office file that inflates past the ceiling when unzipped. Permanent: the
 * same bytes inflate the same way every time.
 */
export class OfficeFileTooLarge extends Error {
  constructor(reason: string) {
    super(
      `This file expands to more than ` +
        `${MAX_OFFICE_DECOMPRESSED_BYTES / 1024 / 1024} MB when opened ` +
        `(${reason}). Upload a smaller one.`,
    );
  }
}

/**
 * Refuses a `.docx` or `.xlsx` whose zip inflates past
 * `MAX_OFFICE_DECOMPRESSED_BYTES` or holds more than `MAX_OFFICE_ENTRIES`
 * files, before a parser inflates it whole.
 *
 * Counts the bytes as each entry actually inflates, in chunks, and stops at
 * the ceiling: a zip's declared sizes are written by whoever made the file.
 * The inflated bytes are dropped as they're counted.
 *
 * A zip this can't read (no central directory, a bad entry) passes through
 * untouched, so the parser refuses it exactly as it did before.
 *
 * @throws OfficeFileTooLarge past either ceiling.
 * @example await assertOfficeZipFits(bytes) // then parse
 */
export async function assertOfficeZipFits(bytes: Buffer): Promise<void> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    return;
  }

  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (entries.length > MAX_OFFICE_ENTRIES) {
    throw new OfficeFileTooLarge(`${entries.length} files inside`);
  }

  let total = 0;
  for (const entry of entries) {
    const result = await inflateCounting(
      entry,
      MAX_OFFICE_DECOMPRESSED_BYTES - total,
    );
    if (result === 'unreadable') return;
    if (result === 'over') {
      throw new OfficeFileTooLarge(`past the ceiling at ${entry.name}`);
    }
    total += result;
  }
}

/**
 * One entry's inflated size, or `'over'` as soon as it passes `budget`.
 * `'unreadable'` for an entry that fails to inflate. jszip inflates in
 * chunks, so nothing past the budget is held.
 */
function inflateCounting(
  entry: JSZip.JSZipObject,
  budget: number,
): Promise<number | 'over' | 'unreadable'> {
  return new Promise((resolve) => {
    let size = 0;
    let settled = false;
    const stream = entry.nodeStream('nodebuffer');
    const settle = (value: number | 'over' | 'unreadable') => {
      if (settled) return;
      settled = true;
      stream.pause();
      stream.removeAllListeners('data');
      resolve(value);
    };

    stream
      .on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > budget) settle('over');
      })
      .on('error', () => settle('unreadable'))
      .on('end', () => settle(size));
  });
}
