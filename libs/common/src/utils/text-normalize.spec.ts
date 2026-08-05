import { isSameText, normalizeForComparison } from './text-normalize';

describe('§3.2 The acceptance comparison (unit)', () => {
  it('1. Treats a TRAILING NEWLINE as the same text', () => {
    // Doc 15 §3.2 test 4b. A rich-text editor adds one on send, and exact
    // equality then reports every untouched draft as EDITED — understating
    // acceptance rate, the single number justifying the co-pilot, by a margin
    // nobody can see.
    expect(isSameText('The limit is 500.', 'The limit is 500.\n')).toBe(true);
  });

  it('2. Treats COLLAPSED whitespace as the same text', () => {
    expect(isSameText('The  limit\tis 500.', 'The limit is 500.')).toBe(true);
  });

  it('3. Treats a DECOMPOSED accent as the same text', () => {
    // `é` as one code point versus `e` + a combining accent. Two encodings of
    // a character a human cannot tell apart, and one of them arrives from a
    // Mac editor.
    expect(isSameText('café', 'café')).toBe(true);
  });

  it('4. Still reports a REAL edit as different', () => {
    // The trade this normalisation makes has a limit: whitespace-only edits
    // read as accepted, but a changed word must not.
    expect(isSameText('The limit is 500.', 'The limit is 750.')).toBe(false);
  });

  it('5. Normalizes BEFORE collapsing, or the two differ in length first', () => {
    // NFC changes the string's length, so collapsing whitespace first would
    // compare two strings that are still different representations of the
    // same text.
    expect(normalizeForComparison('café  au   lait')).toBe('café au lait');
  });

  it('6. Handles an EMPTY or missing draft without throwing', () => {
    // Reachable: `content` is nullable for purposes that store none, and a
    // caller passing the wrong generation id would land here.
    expect(isSameText('', '')).toBe(true);
    expect(isSameText(undefined as unknown as string, '')).toBe(true);
  });
});
