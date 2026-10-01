import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

/**
 * The Java inbound-email limits equal the TypeScript ones they copy.
 *
 * `InboundLimits.java` repeats two sources: `libs/common`'s attachment
 * vocabulary (the allowlist, the file-name and per-message bounds) and the
 * Node gateway's own `dto.config.ts`. The generated Java vocabulary carries
 * neither, so a copy is unavoidable — and a copy that nothing compares is right
 * on the day it is written. This is the comparison.
 *
 * **Scanned from the Java file toward the TypeScript**, never the reverse: a
 * constant Java declares must exist there with the same value, and the allowlist
 * is compared as a set in both directions, so a type added on either side fails.
 */
describe('InboundLimits.java against its TypeScript sources', () => {
  const ROOT = join(__dirname, '../..');
  const java = readFileSync(
    join(
      ROOT,
      'apps/api-gateway-java/src/main/java/com/synapsedesk/gateway/inbound/InboundLimits.java',
    ),
    'utf8',
  );
  const dtoConfig = readFileSync(
    join(ROOT, 'apps/api-gateway/src/common/config/dto.config.ts'),
    'utf8',
  );
  const common = createRequire(join(ROOT, 'libs/common/dist/main.js'))(
    join(ROOT, 'libs/common/dist/main.js'),
  ) as Record<string, unknown>;

  /** Every `public static final int NAME = N;` in the Java file. */
  const javaInts = (): Record<string, number> =>
    Object.fromEntries(
      [...java.matchAll(/public static final int (\w+) = (\d+);/gu)].map(
        ([, name, value]) => [name, Number(value)],
      ),
    );

  /** The TypeScript value of `name`: the built library first, then `dto.config.ts`. */
  const typeScriptInt = (name: string): number | undefined => {
    if (typeof common[name] === 'number') return common[name];
    const declared = new RegExp(`export const ${name} = (\\d+);`, 'u').exec(
      dtoConfig,
    );

    return declared ? Number(declared[1]) : undefined;
  };

  it('**every integer the Java file declares equals its TypeScript counterpart**', () => {
    const ints = javaInts();

    // The pattern-fires floor: a regex that stopped matching would compare
    // nothing and report agreement.
    expect(Object.keys(ints).length).toBeGreaterThanOrEqual(9);

    const mismatches = Object.entries(ints)
      .map(([name, value]) => [name, value, typeScriptInt(name)] as const)
      .filter(([, value, theirs]) => value !== theirs)
      .map(([name, value, theirs]) => `${name}: java ${value}, ts ${theirs}`);

    expect(mismatches).toEqual([]);
  });

  it('**the allowlist is the same SET in both directions**', () => {
    const block =
      /ALLOWED_ATTACHMENT_MIME_TYPES = Set\.of\(([\s\S]*?)\);/u.exec(java)?.[1];
    const mine = [...(block ?? '').matchAll(/"([^"]+)"/gu)]
      .map(([, type]) => type)
      .sort();
    const theirs = [
      ...(common.ALLOWED_ATTACHMENT_MIME_TYPES as readonly string[]),
    ].sort();

    expect(mine.length).toBeGreaterThanOrEqual(10);
    expect(mine).toEqual(theirs);
  });

  it('the printable-ASCII pattern is the same regular expression', () => {
    const javaPattern = /PRINTABLE_ASCII = "((?:[^"\\]|\\.)*)"/u.exec(
      java,
    )?.[1];
    const tsPattern = /export const PRINTABLE_ASCII = \/(.*)\/;/u.exec(
      dtoConfig,
    )?.[1];

    // The Java literal doubles its backslashes; the pattern itself is the same.
    expect(javaPattern?.replace(/\\\\/gu, '\\')).toBe(tsPattern);
  });
});
