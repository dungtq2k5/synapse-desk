package com.synapsedesk.gateway.modules.inboundemail;

import java.util.Arrays;
import java.util.List;

/**
 * JavaScript's whitespace, for the places a mail header's exact handling is
 * what is being reproduced.
 *
 * <p>JS {@code trim()} and {@code /\s+/} strip the Unicode spaces — a no-break
 * space, the BOM, the line separators — that Java's {@code trim()} and
 * {@code strip()} each treat differently. A {@code References} header is
 * sender-controlled and a no-break space in one is ordinary, so this class uses
 * the exact ECMAScript character set rather than an approximation.
 */
final class JsText {

  /** The characters ECMAScript counts as whitespace or line terminators. */
  private static final String WHITESPACE =
    "\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF";

  private static final String RUN = "[" + WHITESPACE + "]+";

  /** A regex fragment for JavaScript's {@code \\s}. */
  static final String WS = "[" + WHITESPACE + "]";

  /** A regex fragment for JavaScript's {@code \\S}. */
  static final String NOT_WS = "[^" + WHITESPACE + "]";

  private JsText() {}

  static boolean isWhitespace(char c) {
    return String.valueOf(c).matches("[" + WHITESPACE + "]");
  }

  static String trim(String value) {
    int start = 0;
    int end = value.length();

    while (start < end && isWhitespace(value.charAt(start))) start++;
    while (end > start && isWhitespace(value.charAt(end - 1))) end--;

    return value.substring(start, end);
  }

  /** {@code value.split(/\s+/).filter(Boolean)}. */
  static List<String> splitOnWhitespace(String value) {
    return Arrays.stream(value.split(RUN))
      .filter(part -> !part.isEmpty())
      .toList();
  }
}
