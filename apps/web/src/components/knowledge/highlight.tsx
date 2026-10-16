import type { ReactNode } from 'react';

/** Words too common to mark: a search's question words, not its subject. */
const COMMON = new Set(
  'a an and are as at be but by can could did do does for from had has have how i if in into is it its may me my of on or our should so than that the their then there these they this to was we were what when where which who why will with would you your'.split(
    ' ',
  ),
);

/**
 * A passage with the query's words marked: each word of the passage that
 * starts with a word of the query ("reset" marks "resets"), common words
 * aside. The marks are Semi Bold and underlined, so they don't rely on color.
 *
 * @example highlight('The allowance resets on 1 January', 'When does the allowance reset?')
 */
export function highlight(text: string, query: string): ReactNode[] {
  const words = [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((word) => word.length > 1 && !COMMON.has(word)),
    ),
  ];
  if (words.length === 0) return [text];
  return text.split(/([\p{L}\p{N}]+)/u).map((part, index) =>
    index % 2 === 1 &&
    words.some((word) => part.toLowerCase().startsWith(word)) ? (
      <mark
        key={index}
        className="bg-transparent font-semibold text-current underline underline-offset-2"
      >
        {part}
      </mark>
    ) : (
      part
    ),
  );
}
