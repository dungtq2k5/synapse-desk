import { once } from 'node:events';
import { createDeflateRaw, crc32 } from 'node:zlib';

/** One entry's deflated bytes, with what a zip header says about them. */
export type DeflatedEntry = {
  data: Buffer;
  crc: number;
  inflatedSize: number;
};

/**
 * `chunk` repeated `times`, deflated as one stream without ever holding the
 * inflated bytes: a few hundred KB that inflate to `chunk.length * times`.
 *
 * @example await deflateRepeated(Buffer.from('<w:p/>'.repeat(1e5)), 500)
 */
export async function deflateRepeated(
  chunk: Buffer,
  times: number,
): Promise<DeflatedEntry> {
  const deflate = createDeflateRaw({ level: 9 });
  const out: Buffer[] = [];
  deflate.on('data', (piece: Buffer) => out.push(piece));

  let crc = 0;
  for (let index = 0; index < times; index += 1) {
    crc = crc32(chunk, crc);
    if (!deflate.write(chunk)) await once(deflate, 'drain');
  }
  deflate.end();
  await once(deflate, 'end');

  return { data: Buffer.concat(out), crc, inflatedSize: chunk.length * times };
}

/**
 * A zip of `entries`, written by hand so a test can make one that no zip
 * library would: `declaredSize` overrides what the headers say an entry
 * inflates to, which is how a bomb lies.
 *
 * @example zipOf([{ name: 'word/document.xml', entry, declaredSize: 1000 }])
 */
export function zipOf(
  entries: Array<{
    name: string;
    entry: DeflatedEntry;
    declaredSize?: number;
  }>,
): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const { name, entry, declaredSize } of entries) {
    const fileName = Buffer.from(name, 'utf8');
    const size = declaredSize ?? entry.inflatedSize;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(entry.crc >>> 0, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(fileName.length, 26);
    locals.push(local, fileName, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(entry.crc >>> 0, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(fileName.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, fileName);

    offset += 30 + fileName.length + entry.data.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, directory, end]);
}
