package com.synapsedesk.gateway.inbound;

import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * The two checks that stop a mail loop.
 *
 * <p><b>The failure these prevent reaches somebody else's inbox.</b> An
 * auto-responder on the other end of a refused address plus a courtesy reply from
 * us is an exchange with no upper bound, and every message in it is real mail
 * somebody receives. So they are decided before anything is written.
 *
 * <p>Pure: the Node gateway's {@code isSelfAddressed} and {@code isAutomated},
 * with the configured sender passed in rather than read from configuration.
 */
public final class LoopGuards {

  private static final List<String> BULK_PRECEDENCES = List.of(
    "bulk",
    "list",
    "junk"
  );

  private LoopGuards() {}

  /**
   * Whether the message came from our own sending address.
   *
   * <p>Compared case-insensitively on the address alone, because {@code From} may
   * be {@code "SynapseDesk Support" <support@…>} and the display name is
   * decoration a sender controls.
   */
  public static boolean isSelfAddressed(String from, String emailSender) {
    return EmailAddresses.extractEmailAddress(from).equals(
      EmailAddresses.extractEmailAddress(emailSender.toLowerCase(Locale.ROOT))
    );
  }

  /**
   * {@code Auto-Submitted} / {@code Precedence} — the headers a machine sets.
   *
   * <p>{@code auto-generated}, {@code auto-replied}, {@code auto-notified}:
   * anything but {@code no}. {@code Auto-Submitted: no} is the value RFC 3834
   * defines for ordinary mail, so treating any presence of the header as automated
   * would silence the reply for a person whose client sets it conscientiously.
   */
  public static boolean isAutomated(Map<String, String> headers) {
    String autoSubmitted = "";
    String precedence = "";

    if (headers != null) {
      for (Map.Entry<String, String> header : headers.entrySet()) {
        String name = header.getKey().toLowerCase(Locale.ROOT);
        String value = String.valueOf(header.getValue()).toLowerCase(
          Locale.ROOT
        );

        if (name.equals("auto-submitted")) autoSubmitted = value;
        if (name.equals("precedence")) precedence = value;
      }
    }

    return (
      (!autoSubmitted.isEmpty() && !autoSubmitted.equals("no")) ||
      BULK_PRECEDENCES.contains(precedence)
    );
  }
}
