import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AI_ELIGIBLE_MIME_TYPES,
  ALLOWED_ATTACHMENT_MIME_TYPES,
  AVATAR_MIME_TYPES,
} from './ticket.config';
import { ALLOWED_DOCUMENT_MIME_TYPES } from './document.config';
import { EXTENSION_BY_MIME, MIME_TYPES, type MimeType } from './mime.config';

describe('the MIME lists agree with each other', () => {
  /**
   * The RELATIONSHIPS between the MIME lists — the half the type system cannot
   * reach.
   *
   * `MimeType` makes every list spell a type the same way, which is what closed
   * the `PurposePolicy` FIXME. It says nothing about whether one list is a subset
   * of another, and every bug this area has produced was exactly that: the
   * gateway accepting twelve types where storage accepted five, an avatar list
   * copied into a DTO, two extension tables mapping the same keys.
   *
   * Read out of `purpose-registry.ts` rather than restated, following
   * `job-run-schema.spec.ts` and `column-bounds.spec.ts`. A test that hard-coded
   * storage's five would agree with a broken policy.
   */
  const policySource = readFileSync(
    join(
      __dirname,
      '../../../../apps/storage-service/src/common/purpose-registry.ts',
    ),
    'utf8',
  );

  const policyAllowlist = (purpose: string): string[] => {
    const block = new RegExp(
      `\\[StoragePurpose\\.${purpose}\\]:\\s*\\{([\\s\\S]*?)\\n  \\}`,
    ).exec(policySource);
    if (!block) {
      throw new Error(
        `no PURPOSE_POLICY entry for ${purpose} — was it renamed?`,
      );
    }

    const list = /mimeAllowlist:\s*\[([\s\S]*?)\]/.exec(block[1]);
    if (!list) throw new Error(`${purpose} has no mimeAllowlist`);

    return [...list[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  };

  it('the policy file is readable and non-empty', () => {
    // Guards the guard: a moved file would make every subset assertion below
    // vacuously true of an empty array.
    expect(policyAllowlist('TICKET_ATTACHMENT').length).toBeGreaterThan(0);
    expect(policyAllowlist('DOCUMENT').length).toBeGreaterThan(0);
  });

  describe('the gateway never accepts what storage will refuse', () => {
    // The drift that shipped: twelve types at the edge against five at presign,
    // so `.docx` passed validation and died on the second hop with a 400 for a
    // type the API contract had just accepted.
    it.each([
      ['attachments', ALLOWED_ATTACHMENT_MIME_TYPES, 'TICKET_ATTACHMENT'],
      ['documents', ALLOWED_DOCUMENT_MIME_TYPES, 'DOCUMENT'],
      ['avatars', AVATAR_MIME_TYPES, 'AVATAR'],
    ])('%s', (_label, gatewayList, purpose) => {
      const storage = policyAllowlist(purpose);

      expect(
        (gatewayList as readonly string[]).filter(
          (mime) => !storage.includes(mime),
        ),
      ).toEqual([]);
    });
  });

  it('**every STORABLE attachment type can reach the model**', () => {
    // The one-directional invariant, and the direction is the point.
    // `AI_ELIGIBLE` may be WIDER — `image/gif` and `text/csv` are pre-approved
    // for a storage policy that has not widened yet. It must never be
    // NARROWER, because that is the state where a user uploads a file and the
    // model silently ignores it.
    expect(
      (ALLOWED_ATTACHMENT_MIME_TYPES as readonly string[]).filter(
        (mime) => !(AI_ELIGIBLE_MIME_TYPES as readonly string[]).includes(mime),
      ),
    ).toEqual([]);
  });

  it('every type any policy names is in the vocabulary', () => {
    // Catches a policy widened with a literal that never reached `MIME_TYPES` —
    // the direction `satisfies` cannot check, because the policy file is read
    // as text here rather than imported.
    const unknown = ['AVATAR', 'TICKET_ATTACHMENT', 'EXPORT', 'DOCUMENT']
      .flatMap(policyAllowlist)
      .filter((mime) => !(MIME_TYPES as readonly string[]).includes(mime));

    expect([...new Set(unknown)]).toEqual([]);
  });

  it('every uploadable type has an extension', () => {
    // `extensionFor` falls back to `bin`, which is right for a naming gap and
    // wrong as a default: an object stored as `.bin` is one nobody can open by
    // double-clicking. EXPORT is excluded — those are generated, and `text/csv`
    // and `application/json` are named by the producer.
    const missing = ['AVATAR', 'TICKET_ATTACHMENT', 'DOCUMENT']
      .flatMap(policyAllowlist)
      .filter((mime) => !(mime in EXTENSION_BY_MIME));

    expect([...new Set(missing)]).toEqual([]);
  });

  it('the vocabulary has no member no list uses', () => {
    // A vocabulary entry nothing names is a type nobody can send, sitting in
    // the file that exists to say what may be sent. `MIME_TYPES` is added to
    // when a list needs a member, never in advance.
    const used = new Set<string>([
      ...['AVATAR', 'TICKET_ATTACHMENT', 'EXPORT', 'DOCUMENT'].flatMap(
        policyAllowlist,
      ),
      ...(AI_ELIGIBLE_MIME_TYPES as readonly string[]),
    ]);

    expect(MIME_TYPES.filter((mime: MimeType) => !used.has(mime))).toEqual([]);
  });
});
