/**
 * The comparison that decides whether the co-pilot's headline metric is real.
 *
 * An agent who presses "send" on a draft without changing a word has ACCEPTED
 * it. Exact string equality says otherwise surprisingly often: a rich-text
 * editor adds a trailing newline, collapses a double space, or emits `é` as
 * `e` + a combining accent instead of the precomposed character. Every one of
 * those reports as EDITED, and acceptance rate — the single number justifying
 * the feature — is understated by a margin nobody can see.
 *
 * Normalising in the other direction has a cost too: a genuinely edited draft
 * that differs only in whitespace would be called ACCEPTED. That is the right
 * trade, because whitespace-only edits are not what "the agent rewrote it"
 * means to anyone reading the metric.
 */

/**
 * NFC, whitespace collapsed, trimmed.
 *
 * NFC first, and it has to be first: composing characters changes the string's
 * length and content, so collapsing whitespace before normalising would compare
 * two strings that are still different representations of the same text.
 */
export function normalizeForComparison(text: string): string {
  return (text ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** True when two texts are the same modulo the differences above. */
export function isSameText(left: string, right: string): boolean {
  return normalizeForComparison(left) === normalizeForComparison(right);
}
