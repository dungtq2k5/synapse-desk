import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

/**
 * The gateway's inbound-email limits equal the shared ones they copy.
 *
 * `InboundLimits.java` repeats `packages/contracts`'s attachment vocabulary (the
 * allowlist, the file-name and per-message bounds), which the generated Java
 * vocabulary does not carry, so a copy is unavoidable — and a copy that nothing
 * compares is right on the day it is written. This is the comparison.
 *
 * **Scanned from the Java file toward `packages/contracts`**, never the reverse: every
 * integer Java declares either equals its `packages/contracts` counterpart or is named in
 * {@link GATEWAY_OWNED} as the gateway's own, so a new one is neither until someone
 * decides. The allowlist is compared as a set in both directions, so a type added
 * on either side fails.
 */
describe('InboundLimits.java against packages/contracts', () => {
  const ROOT = join(__dirname, '../..');
  const java = readFileSync(
    join(
      ROOT,
      'services/api-gateway/src/main/java/com/synapsedesk/gateway/modules/inboundemail/InboundLimits.java',
    ),
    'utf8',
  );
  const common = createRequire(join(ROOT, 'packages/contracts/dist/index.js'))(
    join(ROOT, 'packages/contracts/dist/index.js'),
  ) as Record<string, unknown>;

  /** Every `public static final int NAME = N;` in the Java file. */
  const javaInts = (): Record<string, number> =>
    Object.fromEntries(
      [...java.matchAll(/public static final int (\w+) = (\d+);/gu)].map(
        ([, name, value]) => [name, Number(value)],
      ),
    );

  /**
   * The integers the gateway owns: limits on what an inbound mail may carry, which
   * no other service reads. Named, so a Java integer that is neither shared nor
   * listed here fails rather than leaving the comparison quietly.
   */
  const GATEWAY_OWNED = new Set([
    'MAX_PRESENTED_ATTACHMENTS',
    'MAX_MESSAGE_ID_LENGTH',
    'MAX_EMAIL_ADDRESS_LENGTH',
    'MAX_FULL_NAME_LENGTH',
    'MAX_HEADER_LINE_LENGTH',
    'MAX_DATE_HEADER_LENGTH',
    'MAX_INBOUND_BODY_LENGTH',
  ]);

  it("**every integer the Java file declares equals its packages/contracts counterpart, or is the gateway's own**", () => {
    const ints = javaInts();
    const compared = Object.keys(ints).filter(
      (name) => !GATEWAY_OWNED.has(name),
    );

    // The pattern-fires floor, derived: every shared integer compared. A regex
    // that stopped matching would compare nothing and report agreement.
    expect(compared.length).toBeGreaterThanOrEqual(5);

    const mismatches = compared
      .map((name) => [name, ints[name], common[name]] as const)
      .filter(([, value, theirs]) => value !== theirs)
      .map(
        ([name, value, theirs]) =>
          `${name}: java ${value}, common ${String(theirs)}`,
      );

    expect(mismatches).toEqual([]);
    // And the list names nothing the file no longer declares.
    expect([...GATEWAY_OWNED].filter((name) => !(name in ints))).toEqual([]);
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
});
