import { registerDecorator, ValidationOptions } from 'class-validator';
import { NON_LATIN_OCR_LANGUAGES, OcrLanguage } from '@synapsedesk/common';

/**
 * At most one non-Latin OCR language — 34-doc §4.2 rule 3.
 *
 * **Measured, and the reason is not the one the design gave.** The expectation
 * was that two Han scripts would fight and wreck accuracy. They do not:
 * `jpn+chi_sim` scored 0.00% character error on Japanese, identical to `jpn`
 * alone. What the second CJK model costs is TIME — 578ms against 965ms, and
 * 1359ms once English joins them.
 *
 * So the rule holds for a different reason: a second non-Latin model buys
 * exactly nothing and roughly doubles the per-page cost, on the one path in
 * this service already measured in seconds per page. The numbers are recorded
 * beside `MAX_OCR_LANGUAGES`.
 *
 * **It refuses rather than silently dropping one.** An uploader who named both
 * Japanese and Chinese has told us something we cannot act on; picking one for
 * them produces a document OCR'd in a language they did not ask for, and the
 * evidence of that choice is nowhere. The message names both so the fix is
 * obvious.
 *
 * **Order is the thing that actually costs accuracy**, and no validator can
 * catch it: naming English first on a Vietnamese document scored 2.41% against
 * 0.00% the other way round. That is a UI concern — the primary language must
 * be first — and it is why the list is never sorted on its way through.
 *
 * **Compose it with `@IsIn(OCR_LANGUAGES, { each: true })`, do not replace it.**
 * This constraint answers only "are two scripts fighting"; an unsupported code
 * is a different complaint and belongs in a different message.
 */
export function AtMostOneNonLatinScript(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'atMostOneNonLatinScript',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          // Not an array, or absent, is somebody else's complaint —
          // `@IsArray()` and `@IsOptional()` already say it better.
          if (!Array.isArray(value)) return true;

          const nonLatin = value.filter((code) =>
            NON_LATIN_OCR_LANGUAGES.includes(code as OcrLanguage),
          );

          return nonLatin.length <= 1;
        },
        defaultMessage(): string {
          return (
            `$property may name at most one of ${NON_LATIN_OCR_LANGUAGES.join(', ')} — ` +
            'two non-Latin scripts make OCR markedly worse than either alone'
          );
        },
      },
    });
  };
}
