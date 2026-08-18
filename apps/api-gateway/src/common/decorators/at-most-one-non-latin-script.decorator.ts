import { registerDecorator, ValidationOptions } from 'class-validator';
import { NON_LATIN_OCR_LANGUAGES, OcrLanguage } from '@synapsedesk/common';

/**
 * At most one non-Latin OCR language.
 *
 * A second CJK model buys nothing and roughly doubles per-page cost:
 * `jpn+chi_sim` scored 0.00% character error on Japanese, identical to `jpn`
 * alone, at 965ms against 578ms. Measurements are in
 * `docs/decisions/0035-ocr-language-cap-is-a-cpu-bound.md`.
 *
 * **It refuses rather than silently dropping one.** An uploader who named both
 * Japanese and Chinese has told us something we cannot act on; picking one for
 * them OCRs the document in a language they did not ask for, with no evidence
 * of the choice. The message names both.
 *
 * **Compose it with `@IsIn(OCR_LANGUAGES, { each: true })`, do not replace it.**
 * This answers only "are two scripts fighting"; an unsupported code is a
 * different complaint.
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
