package com.synapsedesk.gateway.error;

import java.util.List;

/**
 * One message, ending in a single `!` — the Node gateway's `formatErrorMsg`,
 * reproduced.
 *
 * <p><b>This text is OURS, so it is byte-equal across implementations.</b> The
 * rule for what the two gateways must agree on is where a string is authored:
 * the joining, the trimming and the trailing `!` are written in this
 * repository, so they are the contract. A runtime's own text — a JSON
 * parser's, a Bean Validation constraint's — is not, and is matched loosely.
 *
 * <p>The trimming is greedy on purpose: `formatErrorMsg` strips EVERY trailing
 * `.`, `!` or `?` before adding one `!`, so `"Nope..."` and `"Nope!"` both end
 * as `"Nope!"`. A single-character trim would leave `"Nope.."`.
 */
public final class ErrorMessages {

  private ErrorMessages() {}

  /** class-validator's array joined as the Node side joins it. */
  public static final String SEPARATOR = ", ";

  /**
   * Trims trailing sentence punctuation and appends exactly one `!`.
   *
   * @example format("email must be an email.") // "email must be an email!"
   */
  public static String format(String message) {
    int end = message.length();

    while (end > 0) {
      char last = message.charAt(end - 1);
      if (last != '.' && last != '!' && last != '?') {
        break;
      }
      end--;
    }

    return message.substring(0, end) + "!";
  }

  /** Several constraint messages as one sentence, then {@link #format}. */
  public static String format(List<String> messages) {
    return format(String.join(SEPARATOR, messages));
  }
}
