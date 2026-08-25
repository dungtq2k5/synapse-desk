import { AVATAR_MIME_TYPES } from './auth.config';
import {
  AI_ELIGIBLE_MIME_TYPES,
  ALLOWED_ATTACHMENT_MIME_TYPES,
  PARSE_ELIGIBLE_MIME_TYPES,
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

  it('**a type is fed as BYTES or as extracted TEXT, never eligible for both**', () => {
    // `ticket.config.ts` calls this disjointness "by construction". There is no
    // construction: both lists are `satisfies readonly
    // AllowedAttachmentMimeType[]`, which compile-checks each as a SUBSET of
    // storable and says nothing about their intersection.
    //
    // **What an overlap would do is worse than ambiguous.**
    // `AiAttachmentService` decides the branch on `AI_ELIGIBLE` alone, so a type
    // in both lists takes the bytes path and the stored markdown is never read
    // — confirm pays for the parse, Postgres keeps the result, and the model
    // receives bytes it cannot parse. For `.docx` that is a silent return to
    // pre-extraction behaviour.
    //
    // Empty today. This is the mechanism the docblock claims to have.
    const overlap = (PARSE_ELIGIBLE_MIME_TYPES as readonly string[]).filter(
      (mime) => (AI_ELIGIBLE_MIME_TYPES as readonly string[]).includes(mime),
    );

    expect(overlap).toEqual([]);
  });

  it('**`.doc` is storable, never parsed, and never fed**', async () => {
    // Doc 56 §A, and all three clauses are load-bearing in different
    // directions.
    //
    // Mammoth reads OOXML. A genuine Word 97-2003 file is an OLE2 compound
    // binary and throws `Can't find end of central directory : is this a zip
    // file ?` — a bare `Error`, so it misses the deterministic-refusal arm and
    // costs `attempts: 3` before failing with a message about zip files.
    //
    // **Storable is the half that would go quietly.** Dropping it everywhere
    // reads as tidier and takes away a format an agent can legitimately be
    // sent; the decision is that it stays attachable and stops pretending to
    // be parseable.
    const DOC = 'application/msword';

    expect(ALLOWED_ATTACHMENT_MIME_TYPES as readonly string[]).toContain(DOC);
    expect(ALLOWED_DOCUMENT_MIME_TYPES as readonly string[]).not.toContain(DOC);
    expect(AI_ELIGIBLE_MIME_TYPES as readonly string[]).not.toContain(DOC);

    // And the derived list follows, which is the thing a filter is built from:
    // a `documents` row can no longer be filed under `doc` at all.
    const { DOCUMENT_FILE_TYPES } = await import('./document.config');
    expect(DOCUMENT_FILE_TYPES as readonly string[]).not.toContain('doc');
    // The mapping itself STAYS — an attachment still needs its extension.
    expect(EXTENSION_BY_MIME[DOC]).toBe('doc');
  });
});
