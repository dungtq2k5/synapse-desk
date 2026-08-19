import { AVATAR_MIME_TYPES } from './auth.config';
import {
  AI_ELIGIBLE_MIME_TYPES,
  ALLOWED_ATTACHMENT_MIME_TYPES,
} from './ticket.config';
import { ALLOWED_DOCUMENT_MIME_TYPES } from './document.config';
import { EXPORT_MIME_TYPES } from './export.config';
import { EXTENSION_BY_MIME, MIME_TYPES, type MimeType } from './mime.config';

describe('the MIME lists agree with each other', () => {
  /**
   * The RELATIONSHIPS between the MIME lists — the half the type system cannot
   * reach.
   *
   * `MimeType` makes every list spell a type the same way, and `PURPOSE_POLICY`
   * now REFERENCES these lists rather than restating them, so "the gateway
   * accepts what storage refuses" is a shape the code can no longer take. What
   * remains is subset-ness BETWEEN different lists, which nothing structural
   * enforces: every storable attachment must be AI-eligible, every uploadable
   * type must have an extension, and the vocabulary must carry no member no
   * list uses.
   */
  /** Every list a storage policy names — `PURPOSE_POLICY` is built from these. */
  const POLICY_LISTS: readonly (readonly string[])[] = [
    AVATAR_MIME_TYPES,
    ALLOWED_ATTACHMENT_MIME_TYPES,
    EXPORT_MIME_TYPES,
    ALLOWED_DOCUMENT_MIME_TYPES,
  ];

  /** The subset a CALLER uploads — exports are generated and named by us. */
  const UPLOADABLE_LISTS: readonly (readonly string[])[] = [
    AVATAR_MIME_TYPES,
    ALLOWED_ATTACHMENT_MIME_TYPES,
    ALLOWED_DOCUMENT_MIME_TYPES,
  ];

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
    const unknown = POLICY_LISTS.flat().filter(
      (mime) => !(MIME_TYPES as readonly string[]).includes(mime),
    );

    expect([...new Set(unknown)]).toEqual([]);
  });

  it('every uploadable type has an extension', () => {
    // `extensionFor` falls back to `bin`, which is right for a naming gap and
    // wrong as a default: an object stored as `.bin` is one nobody can open by
    // double-clicking. EXPORT is excluded — those are generated, and `text/csv`
    // and `application/json` are named by the producer.
    const missing = UPLOADABLE_LISTS.flat().filter(
      (mime) => !(mime in EXTENSION_BY_MIME),
    );

    expect([...new Set(missing)]).toEqual([]);
  });

  it('the vocabulary has no member no list uses', () => {
    // A vocabulary entry nothing names is a type nobody can send, sitting in
    // the file that exists to say what may be sent. `MIME_TYPES` is added to
    // when a list needs a member, never in advance.
    const used = new Set<string>([
      ...POLICY_LISTS.flat(),
      ...(AI_ELIGIBLE_MIME_TYPES as readonly string[]),
    ]);

    expect(MIME_TYPES.filter((mime: MimeType) => !used.has(mime))).toEqual([]);
  });
});
