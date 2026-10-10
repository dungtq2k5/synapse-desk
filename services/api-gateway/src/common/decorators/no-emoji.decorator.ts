import { registerDecorator, ValidationOptions } from 'class-validator';

/**
 * Every codepoint class that means "emoji". Composed by {@link NoEmoji}.
 *
 * Four branches, because three shapes carry no pictographic property of their
 * own and are invisible to a check that looks for one:
 *
 * | Branch | Catches | Example that needs IT and no other |
 * | :---- | :---- | :---- |
 * | `Extended_Pictographic` | ordinary emoji, and ZWJ sequences via their parts | `Support`, `Family` |
 * | `Emoji_Modifier` | a BARE skin-tone modifier | `Palette` (the modifier alone) |
 * | `Regional_Indicator` | flags, which are two indicator codepoints | `Team` |
 * | `\uFE0F` | a keycap: an ordinary character wearing emoji presentation | `Tier 1` + U+FE0F U+20E3 |
 *
 * **The examples are chosen so each one needs its own branch.** The obvious
 * illustrations do not: a thumbs-up with a skin tone and a trademark sign with
 * U+FE0F are both caught by `Extended_Pictographic` alone, because the base
 * character carries that property. Deleting either of the other two branches
 * left every test green until the examples were changed to ones that isolate
 * them.
 *
 * **U+FE0F is written as `\uFE0F`, never as the literal character**, and this
 * is not a style preference. It is invisible in source: spelled literally the
 * branch reads as an empty alternation, and a reformat or a lint autofix
 * deletes it with nothing on screen to show what went. **That has already
 * happened once in this file** — the branch vanished between two runs and only
 * the keycap case going green revealed it. `no-emoji.decorator.spec.ts` now
 * asserts the source stays ASCII, which is the check that would have caught it.
 */
const EMOJI_PATTERN =
  /\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|\uFE0F/u;

/**
 * Emoji, and only emoji.
 *
 * **The rule this must NOT be is "ASCII only".** This product speaks eight
 * languages (`OCR_LANGUAGES`), including `vi`, `ja` and `zh`, with matching
 * greeting and refusal tables in rag-service. `Nguyễn Văn A` and `田中太郎` are
 * names it is explicitly built to serve, and any codepoint-range rule that
 * excludes emoji by excluding non-ASCII rejects both.
 *
 * **`\p{Extended_Pictographic}`, never `\p{Emoji}`.** The second is the
 * plausible choice and it is wrong:
 *
 * ```ts
 * /\p{Emoji}/u.test('Team 2')  // true — the ASCII digit
 * /\p{Emoji}/u.test('#tag')    // true — `#` carries Emoji=Yes
 * ```
 *
 * `Emoji=Yes` covers `0`–`9`, `#` and `*` because those form keycap sequences,
 * so a validator built on it rejects `Team 2` and `Tier 1 Support` and the
 * refusal looks arbitrary to whoever hits it. `Extended_Pictographic` is the
 * property that means what "emoji" means in conversation.
 *
 * The four branches and why each exists are tabulated at
 * {@link EMOJI_PATTERN}. Two of those rows had illustrative examples that did
 * NOT exercise the branch they named — a thumbs-up with a skin tone and a
 * trademark sign are both caught by `Extended_Pictographic` alone — so the
 * table there now uses examples that need their own branch and nothing else.
 *
 * **Compose it with `@IsString()`/`@MinLength()`, do not replace them.** This
 * answers only "does it contain an emoji"; a non-string or an empty value is
 * somebody else's complaint and must fail with somebody else's message.
 */
export function NoEmoji(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'noEmoji',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          // Not a string is somebody else's complaint — `@IsString()` already
          // says it better, and failing here would report a name as containing
          // an emoji when it is in fact a number.
          if (typeof value !== 'string') return true;

          return !EMOJI_PATTERN.test(value);
        },
        defaultMessage(): string {
          return '$property must not contain emoji';
        },
      },
    });
  };
}
