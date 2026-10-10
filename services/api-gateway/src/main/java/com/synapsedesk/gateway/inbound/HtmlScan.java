package com.synapsedesk.gateway.inbound;

/**
 * The HTML patterns {@link QuotedReply} needs, as scanners whose time is LINEAR in
 * the input, with output identical to the regular expressions they replace.
 *
 * <p><b>Why not regular expressions.</b> {@code <[^>]+>}, {@code
 * <script[\s\S]*?</script>} and {@code <div[^>]*class="…} each rescan to the end of
 * the input from every opener that is never closed, so a body of many unclosed tags
 * costs time proportional to the SQUARE of its length, and the Java regex engine is
 * especially slow on that shape. The BEHAVIOUR is kept: the fixed tables
 * {@code quoted-reply-parity.json} and {@code quoted-reply-fuzz.json} (under
 * {@code test/fixtures/inbound-email/}) hold these scanners to the regular
 * expressions' answers on awkward and on randomized input.
 *
 * <p><b>The one idea.</b> A search that fails from an opener fails from every later
 * opener of the same kind, because its search area is a subset. Each scanner
 * remembers that once and stops searching, so failures cost nothing after the first;
 * and a window that several openers share (everything up to the next {@code >}) is
 * answered from tables built once, not rescanned per opener.
 *
 * <p><b>Case.</b> ASCII-only folding, as both regular expressions' {@code i} flag
 * does without Unicode mode: {@code U+017F} (long s) and {@code U+212A} (Kelvin
 * sign) do NOT match {@code s} and {@code k}. {@link String#regionMatches} would
 * match them, which is why it is not used.
 */
final class HtmlScan {

  private HtmlScan() {}

  /**
   * How much the scanners have done, in steps: characters walked, comparisons made,
   * and the span every {@code indexOf} jump skipped. Every step is constant work, so
   * this IS the cost, and unlike a stopwatch it does not depend on the machine: a
   * test asserts it grows in proportion to the input, which catches a scanner that
   * went quadratic even on a box fast enough to hide it.
   *
   * <p>A plain static, not thread-safe: the count is exact only while one thread
   * scans, which is how the test reads it. In production it is incremented and never
   * read, on a path that runs once per inbound mail, so a lost update costs nothing.
   */
  static long work;

  /** {@code <(script|style)[\s\S]*?</\1>} removed, case-insensitively. */
  static String removeScriptAndStyle(String text) {
    int length = text.length();
    StringBuilder kept = new StringBuilder(length);
    boolean noScriptClose = false;
    boolean noStyleClose = false;
    int i = 0;

    while (i < length) {
      work++;
      char c = text.charAt(i);
      if (c == '<') {
        boolean script = at(text, i + 1, "script");
        boolean style = !script && at(text, i + 1, "style");
        int end = -1;

        if (script && !noScriptClose) {
          end = endOfClosing(text, i + 1 + "script".length(), "</script>");
          noScriptClose = end < 0;
        } else if (style && !noStyleClose) {
          end = endOfClosing(text, i + 1 + "style".length(), "</style>");
          noStyleClose = end < 0;
        }

        if (end >= 0) {
          i = end;
          continue;
        }
      }
      kept.append(c);
      i++;
    }

    return kept.toString();
  }

  /** {@code <li[^>]*>} replaced by {@code "- "}, case-insensitively. */
  static String listItemStarts(String text) {
    int length = text.length();
    int lastGt = text.lastIndexOf('>');
    StringBuilder kept = new StringBuilder(length);
    int i = 0;

    while (i < length) {
      work++;
      char c = text.charAt(i);
      if (c == '<' && at(text, i + 1, "li")) {
        if (lastGt < i + 3) {
          // No `>` is left for this opener, so none is left for any later one.
          kept.append(text, i, length);
          break;
        }
        int close = text.indexOf('>', i + 3);
        work += (close < 0 ? length : close) - i;
        kept.append("- ");
        i = close + 1;
        continue;
      }
      kept.append(c);
      i++;
    }

    return kept.toString();
  }

  /** {@code <[^>]+>} removed. */
  static String removeTags(String text) {
    int length = text.length();
    int lastGt = text.lastIndexOf('>');
    StringBuilder kept = new StringBuilder(length);
    int i = 0;

    while (i < length) {
      work++;
      char c = text.charAt(i);
      if (c == '<') {
        if (i >= lastGt) {
          // No `>` follows, so no tag can close from here on.
          kept.append(text, i, length);
          break;
        }
        int close = text.indexOf('>', i + 1);
        work += (close < 0 ? length : close) - i;
        if (close > i + 1) {
          i = close + 1;
          continue;
        }
        // `<>`: the class needs at least one character before the `>`.
      }
      kept.append(c);
      i++;
    }

    return kept.toString();
  }

  /**
   * The start of the earliest quoted-history container in an HTML body, or its
   * length when there is none: Gmail's {@code <div …class="…gmail_quote},
   * Outlook's {@code <div …id="appendonsend"}, any {@code <blockquote}, and
   * {@code <hr …id="stopSpelling"} — each case-insensitive, and each tag's
   * attributes read only up to its own first {@code >}.
   */
  static int earliestQuotedContainer(String html) {
    int length = html.length();
    int cut = indexOfBlockquote(html);

    int[] nextGt = nextOf(html, '>');
    int[] nextQuote = nextOf(html, '"');
    int[] nextGmail = nextLiteral(html, "gmail_quote");
    // `class="` followed, with no `"` between, by `gmail_quote`.
    int[] gmailClass = prefixCounts(
      html,
      "class=\"",
      p ->
        nextGmail[p + "class=\"".length()] < nextQuote[p + "class=\"".length()]
    );
    int[] appendOnSend = prefixCounts(html, "id=\"appendonsend\"", p -> true);
    int[] stopSpelling = prefixCounts(html, "id=\"stopspelling\"", p -> true);

    for (
      int i = html.indexOf('<');
      i >= 0 && i < cut;
      i = html.indexOf('<', i + 1)
    ) {
      work++;
      if (at(html, i + 1, "div")) {
        int from = i + 4;
        int close = nextGt[from];
        if (
          inWindow(gmailClass, from, close - "class=\"".length(), length) ||
          inWindow(
            appendOnSend,
            from,
            close - "id=\"appendonsend\"".length(),
            length
          )
        ) {
          return i;
        }
      } else if (at(html, i + 1, "hr")) {
        int from = i + 3;
        int close = nextGt[from];
        if (
          inWindow(
            stopSpelling,
            from,
            close - "id=\"stopspelling\"".length(),
            length
          )
        ) {
          return i;
        }
      }
    }

    return cut;
  }

  // ------------------------------------------------------------- helpers

  /** Whether {@code lower} (already lower-case ASCII) is at {@code index}, ignoring ASCII case. */
  private static boolean at(String text, int index, String lower) {
    work++;
    if (index < 0 || index + lower.length() > text.length()) return false;
    for (int k = 0; k < lower.length(); k++) {
      char c = text.charAt(index + k);
      if (c >= 'A' && c <= 'Z') c += 'a' - 'A';
      if (c != lower.charAt(k)) return false;
    }

    return true;
  }

  /** The index just past the first {@code closing} at or after {@code from}, or -1. */
  private static int endOfClosing(String text, int from, String closing) {
    int previous = from;
    for (
      int j = text.indexOf('<', from);
      j >= 0;
      j = text.indexOf('<', j + 1)
    ) {
      work += 1 + j - previous;
      previous = j;
      if (at(text, j, closing)) return j + closing.length();
    }
    work += text.length() - previous;

    return -1;
  }

  private static int indexOfBlockquote(String html) {
    int previous = 0;
    for (int j = html.indexOf('<'); j >= 0; j = html.indexOf('<', j + 1)) {
      work += 1 + j - previous;
      previous = j;
      if (at(html, j, "<blockquote")) return j;
    }
    work += html.length() - previous;

    return html.length();
  }

  /** {@code next[x]} is the first index at or after {@code x} holding {@code ch}, else the length. */
  private static int[] nextOf(String text, char ch) {
    int length = text.length();
    int[] next = new int[length + 1];
    next[length] = length;
    work += length;
    for (int x = length - 1; x >= 0; x--) {
      next[x] = text.charAt(x) == ch ? x : next[x + 1];
    }

    return next;
  }

  /** {@code next[x]} is the first start at or after {@code x} of {@code lower} (ASCII case aside), else the length. */
  private static int[] nextLiteral(String text, String lower) {
    int length = text.length();
    int[] next = new int[length + 1];
    next[length] = length;
    work += length;
    for (int x = length - 1; x >= 0; x--) {
      next[x] = at(text, x, lower) ? x : next[x + 1];
    }

    return next;
  }

  /** What {@link #prefixCounts} asks of each occurrence. */
  private interface Qualifies {
    boolean at(int start);
  }

  /** {@code counts[k]} is how many qualifying occurrences of {@code lower} start before {@code k}. */
  private static int[] prefixCounts(
    String text,
    String lower,
    Qualifies qualifies
  ) {
    int length = text.length();
    int[] counts = new int[length + 2];
    work += length;
    for (int p = 0; p <= length; p++) {
      boolean hit = p < length && at(text, p, lower) && qualifies.at(p);
      counts[p + 1] = counts[p] + (hit ? 1 : 0);
    }

    return counts;
  }

  /** Whether a counted occurrence starts in {@code [from, to]}. */
  private static boolean inWindow(int[] counts, int from, int to, int length) {
    int last = Math.min(to, length - 1);

    return last >= from && counts[last + 1] - counts[from] > 0;
  }
}
