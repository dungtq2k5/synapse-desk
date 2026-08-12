/**
 * Strips quoted history from a reply — 31-doc §4, 32-doc §4.4.
 *
 * **Not cosmetic.** Every reply carries the entire prior thread, so without
 * this `ticket_messages` grows quadratically, and the RAG corpus fills with
 * duplicated text that outranks the real answer — a knowledge base poisoned by
 * its own notifications.
 *
 * **Imperfect by nature, so it errs toward KEEPING text.** A stray quoted line
 * is noise somebody skims past; a stripped real sentence is a customer's
 * message that silently never arrived. Every rule below is anchored to the
 * start of a line and requires a marker no ordinary prose produces.
 */

/**
 * Where the quoted section begins, per client.
 *
 * Each is anchored with `^` under `m`, because these strings appear inside
 * ordinary sentences too — "on tuesday, sarah wrote a spec" is not a quote
 * header, and an unanchored match would delete the rest of the message.
 */
const QUOTE_HEADERS: readonly RegExp[] = [
  // Gmail, Apple Mail, most clients: "On <date>, <name> wrote:" — possibly
  // wrapped onto a second line, which is why `[\s\S]` spans one newline.
  /^On\s[\s\S]{0,200}?\swrote:\s*$/m,
  // Outlook, English and the two other locales this system is likely to meet.
  /^-{2,}\s*Original Message\s*-{2,}\s*$/im,
  /^_{5,}\s*$/m,
  /^From:\s.+$/m,
  // Thunderbird and several mobile clients.
  /^-{2,}\s*Forwarded message\s*-{2,}\s*$/im,
  // The RFC 3676 signature delimiter. Everything after it is a signature,
  // which is quoted-history-adjacent and equally unwanted in a ticket.
  /^--\s*$/m,
];

/** A run of `>`-prefixed lines, which is the quote itself rather than a header. */
const QUOTED_BLOCK = /^(?:>.*(?:\n|$))+/gm;

/**
 * The reply, with quoted history removed.
 *
 * Returns the ORIGINAL text when stripping would leave nothing — a message that
 * is entirely quotation is far more likely to be a client this parser does not
 * know than a customer who wrote nothing, and an empty ticket body helps
 * nobody.
 */
export function stripQuotedReply(text: string): string {
  if (!text.trim()) return text;

  // The EARLIEST header wins. A forwarded thread can carry several, and cutting
  // at the last one would keep every quoted block above it.
  const cut = QUOTE_HEADERS.reduce((earliest, pattern) => {
    const match = pattern.exec(text);

    return match?.index !== undefined && match.index < earliest
      ? match.index
      : earliest;
  }, text.length);

  const stripped = text
    .slice(0, cut)
    .replace(QUOTED_BLOCK, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return stripped || text;
}

/**
 * The reply from an HTML part, with the quoted section removed.
 *
 * **Cut at the container, not by parsing.** Gmail wraps history in
 * `<div class="gmail_quote">`, Outlook in `<div id="appendonsend">` followed by
 * a divider, and everything else in `<blockquote>`. Slicing at the first of
 * those is crude and predictable; running an HTML parser to do it properly
 * would add a dependency and a sanitisation surface for a value that is about
 * to be converted to text anyway.
 */
export function stripQuotedHtml(html: string): string {
  const cut = [
    /<div[^>]*class="[^"]*gmail_quote/i,
    /<div[^>]*id="appendonsend"/i,
    /<blockquote/i,
    /<hr[^>]*id="stopSpelling"/i,
  ].reduce((earliest, pattern) => {
    const match = pattern.exec(html);

    return match?.index !== undefined && match.index < earliest
      ? match.index
      : earliest;
  }, html.length);

  const stripped = html.slice(0, cut).trim();

  return stripped || html;
}

/**
 * The body to store: the text part, or the HTML part reduced to text.
 *
 * **The text part wins whenever there is one.** 31-doc §10 defers faithful
 * HTML→Markdown; this is the "good enough to read" version it describes, and
 * taking the text part first means most mail never meets the lossy path at all.
 */
export function toStoredBody(text: string | null, html: string | null): string {
  if (text?.trim()) return stripQuotedReply(text);
  if (!html?.trim()) return '';

  return stripQuotedReply(htmlToText(stripQuotedHtml(html)));
}

/**
 * The crude HTML→text reduction — 31-doc §10 defers the faithful one.
 *
 * Block boundaries become newlines before tags are dropped, or every paragraph
 * runs into the next and the result is one unreadable line. Entities are
 * decoded last, so a literal `&lt;b&gt;` in the source cannot become a tag that
 * the tag-stripper has already gone past.
 *
 * **`<[^>]+>` is linear, whatever an editor's "super-linear backtracking" hint
 * says.** The class is the complement of the terminator, so at every position
 * exactly one branch can match and there is nothing to backtrack into — the
 * catastrophic shape is `(a+)+`, not this one. It runs on attacker-supplied
 * HTML, so the distinction is worth stating rather than re-litigating.
 *
 * The chain stays regexes throughout even where `replaceAll` would read
 * slightly better, because most members need the `i` flag that a string
 * literal cannot carry, and one odd line out is the worse read.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '') // NOSONAR
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'") // NOSONAR
    .replace(/&amp;/gi, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
