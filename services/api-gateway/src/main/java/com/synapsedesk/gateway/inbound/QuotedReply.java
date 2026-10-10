package com.synapsedesk.gateway.inbound;

import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Strips quoted history from a reply.
 *
 * <p><b>Not cosmetic.</b> Every reply carries the entire prior thread, so without
 * this {@code ticket_messages} grows quadratically, and the RAG corpus fills with
 * duplicated text that outranks the real answer.
 *
 * <p><b>Imperfect by nature, so it errs toward KEEPING text.</b> A stray quoted
 * line is noise somebody skims past; a stripped real sentence is a customer's
 * message that silently never arrived. Every header rule is anchored to the start
 * of a line and requires a marker no ordinary prose produces.
 *
 * <p><b>Line and character classes follow JavaScript regex rules, spelled out.</b>
 * Java's {@code MULTILINE} treats {@code \r\n} as one terminator and {@code U+0085}
 * as a terminator, JS does neither; {@code \s} and {@code .} cover different
 * characters. So {@code ^}, {@code $}, {@code .} and {@code \s} are written as the
 * exact sets JS uses, and the fixed table {@code quoted-reply-parity.json} holds
 * the result to those rules on awkward input.
 *
 * <p><b>The {@code >} block is removed by a scan, not a regex.</b> As a pattern it
 * is a repeated group, which Java matches recursively: a long run of quoted lines
 * in a sender-controlled mail would be a {@code StackOverflowError}.
 *
 * <p><b>The HTML patterns are scanners, not regular expressions</b>
 * ({@link HtmlScan}). {@code <[^>]+>}, {@code <script…</script>} and {@code
 * <div[^>]*class=…} rescan to the end of the input from every opener that is never
 * closed, which is quadratic. The scanners are linear and answer exactly as the
 * patterns do; {@code quoted-reply-fuzz.json} holds them to the patterns' answers
 * on 900 seeded sequences.
 */
public final class QuotedReply {

  /** A position at the start of input or just after a line terminator: JS {@code ^} under {@code m}. */
  private static final String LINE_START = "(?<![^\\n\\r\\u2028\\u2029])";

  /** A position at the end of input or just before a line terminator: JS {@code $} under {@code m}. */
  private static final String LINE_END = "(?![^\\n\\r\\u2028\\u2029])";

  /** JS {@code .}: anything but a line terminator. */
  private static final String NOT_EOL = "[^\\n\\r\\u2028\\u2029]";

  private static final String WS = JsText.WS;

  /**
   * Where the quoted section begins, per client.
   *
   * <p>Each is anchored to the start of a line, because these strings appear
   * inside ordinary sentences too — "on tuesday, sarah wrote a spec" is not a
   * quote header, and an unanchored match would delete the rest of the message.
   */
  private static final List<Pattern> QUOTE_HEADERS = List.of(
    // Gmail, Apple Mail, most clients: "On <date>, <name> wrote:" — possibly
    // wrapped onto a second line, which is why the middle spans newlines.
    Pattern.compile(
      LINE_START +
        "On" +
        WS +
        "[\\s\\S]{0,200}?" +
        WS +
        "wrote:" +
        WS +
        "*" +
        LINE_END
    ),
    // Outlook.
    Pattern.compile(
      LINE_START +
        "-{2,}" +
        WS +
        "*Original Message" +
        WS +
        "*-{2,}" +
        WS +
        "*" +
        LINE_END,
      Pattern.CASE_INSENSITIVE
    ),
    Pattern.compile(LINE_START + "_{5,}" + WS + "*" + LINE_END),
    Pattern.compile(LINE_START + "From:" + WS + NOT_EOL + "+" + LINE_END),
    // Thunderbird and several mobile clients.
    Pattern.compile(
      LINE_START +
        "-{2,}" +
        WS +
        "*Forwarded message" +
        WS +
        "*-{2,}" +
        WS +
        "*" +
        LINE_END,
      Pattern.CASE_INSENSITIVE
    ),
    // The RFC 3676 signature delimiter: everything after it is a signature.
    Pattern.compile(LINE_START + "--" + WS + "*" + LINE_END)
  );

  private static final Pattern THREE_NEWLINES = Pattern.compile("\\n{3,}");

  private QuotedReply() {}

  /**
   * The reply, with quoted history removed.
   *
   * <p>Returns the ORIGINAL text when stripping would leave nothing — a message
   * that is entirely quotation is far more likely to be a client this parser does
   * not know than a customer who wrote nothing.
   */
  public static String stripQuotedReply(String text) {
    if (JsText.trim(text).isEmpty()) return text;

    // The EARLIEST header wins. A forwarded thread can carry several, and
    // cutting at the last one would keep every quoted block above it.
    int cut = text.length();
    for (Pattern header : QUOTE_HEADERS) {
      Matcher match = header.matcher(text);
      if (match.find() && match.start() < cut) cut = match.start();
    }

    String stripped = JsText.trim(
      THREE_NEWLINES.matcher(
        withoutQuotedBlocks(text.substring(0, cut))
      ).replaceAll("\n\n")
    );

    return stripped.isEmpty() ? text : stripped;
  }

  /**
   * Removes every run of lines that start with {@code >}.
   *
   * <p>The scan behaves as {@code /^(?:>.*(?:\n|$))+/gm}: from a line start, a
   * {@code >} line and its {@code \n}, repeated while the next line also starts
   * with {@code >}. A line ending in a different terminator ({@code \r},
   * {@code U+2028}) is removed but its terminator is left, because only {@code \n}
   * is consumed.
   */
  private static String withoutQuotedBlocks(String text) {
    StringBuilder kept = new StringBuilder(text.length());
    int length = text.length();
    int i = 0;

    while (i < length) {
      boolean atLineStart = i == 0 || isTerminator(text.charAt(i - 1));

      if (atLineStart && text.charAt(i) == '>') {
        int end = i;
        while (true) {
          while (end < length && !isTerminator(text.charAt(end))) end++;
          if (end < length && text.charAt(end) == '\n') {
            end++;
            if (end < length && text.charAt(end) == '>') continue;
          }
          break;
        }
        i = end;
      } else {
        kept.append(text.charAt(i));
        i++;
      }
    }

    return kept.toString();
  }

  private static boolean isTerminator(char c) {
    return c == '\n' || c == '\r' || c == ' ' || c == ' ';
  }

  /**
   * The reply from an HTML part, with the quoted section removed.
   *
   * <p><b>Cut at the container, not by parsing.</b> Gmail wraps history in
   * {@code <div class="gmail_quote">}, Outlook in {@code <div id="appendonsend">},
   * and everything else in {@code <blockquote>}. Slicing at the first of those is
   * crude and predictable; an HTML parser would add a dependency and a
   * sanitization surface for a value about to be converted to text anyway.
   */
  public static String stripQuotedHtml(String html) {
    int cut = HtmlScan.earliestQuotedContainer(html);

    String stripped = JsText.trim(html.substring(0, cut));

    return stripped.isEmpty() ? html : stripped;
  }

  /**
   * The body to store: the text part, or the HTML part reduced to text.
   *
   * <p><b>The text part wins whenever there is one</b>, so most mail never meets
   * the lossy HTML path at all.
   */
  public static String toStoredBody(String text, String html) {
    if (text != null && !JsText.trim(text).isEmpty()) return stripQuotedReply(
      text
    );
    if (html == null || JsText.trim(html).isEmpty()) return "";

    return stripQuotedReply(htmlToText(stripQuotedHtml(html)));
  }

  private static final Pattern BR = Pattern.compile(
    "<br" + WS + "*/?>",
    Pattern.CASE_INSENSITIVE
  );
  private static final Pattern BLOCK_END = Pattern.compile(
    "</(p|div|tr|h[1-6]|li)>",
    Pattern.CASE_INSENSITIVE
  );
  private static final Pattern NBSP = Pattern.compile(
    "&nbsp;",
    Pattern.CASE_INSENSITIVE
  );
  private static final Pattern LT = Pattern.compile(
    "&lt;",
    Pattern.CASE_INSENSITIVE
  );
  private static final Pattern GT = Pattern.compile(
    "&gt;",
    Pattern.CASE_INSENSITIVE
  );
  private static final Pattern QUOT = Pattern.compile(
    "&quot;",
    Pattern.CASE_INSENSITIVE
  );
  private static final Pattern APOS = Pattern.compile("&#39;");
  private static final Pattern AMP = Pattern.compile(
    "&amp;",
    Pattern.CASE_INSENSITIVE
  );

  /**
   * The crude HTML→text reduction.
   *
   * <p>Block boundaries become newlines before tags are dropped, or every
   * paragraph runs into the next. Entities are decoded last, so a literal
   * {@code &lt;b&gt;} in the source cannot become a tag the tag-stripper has
   * already gone past. {@code <[^>]+>} is linear: the class is the complement of
   * the terminator, so at every position exactly one branch can match.
   */
  private static String htmlToText(String html) {
    String text = HtmlScan.removeScriptAndStyle(html);
    text = BR.matcher(text).replaceAll("\n");
    text = BLOCK_END.matcher(text).replaceAll("\n");
    text = HtmlScan.listItemStarts(text);
    text = HtmlScan.removeTags(text);
    text = NBSP.matcher(text).replaceAll(" ");
    text = LT.matcher(text).replaceAll("<");
    text = GT.matcher(text).replaceAll(">");
    text = QUOT.matcher(text).replaceAll("\"");
    text = APOS.matcher(text).replaceAll("'");
    text = AMP.matcher(text).replaceAll("&");
    text = THREE_NEWLINES.matcher(text).replaceAll("\n\n");

    return JsText.trim(text);
  }
}
