package com.synapsedesk.gateway.modules.inboundemail;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import org.junit.jupiter.api.Test;

/**
 * Quoted history is stripped and the new text survives, plus the cost of huge
 * sender-controlled input.
 *
 * <p>Every case checks that the reply SURVIVED as well as that the quote went.
 * Over-stripping loses a customer's message silently, which is strictly worse than
 * leaving a quoted line behind.
 */
class QuotedReplyTest {

  private static String lines(String... lines) {
    return String.join("\n", lines);
  }

  @Test
  void gmailOnWroteAndTheQuoteBlockBelowIt() {
    String stripped = QuotedReply.stripQuotedReply(
      lines(
        "Yes, that fixed it. Thanks!",
        "",
        "On Tue, 11 Aug 2026 at 09:14, Support <support@app.test> wrote:",
        "> Have you tried turning it off and on again?",
        "> — The Support Team"
      )
    );

    assertThat(stripped).isEqualTo("Yes, that fixed it. Thanks!");
  }

  @Test
  void outlookOriginalMessageDivider() {
    assertThat(
      QuotedReply.stripQuotedReply(
        lines(
          "Still broken I am afraid.",
          "",
          "-----Original Message-----",
          "From: Support <support@app.test>",
          "Sent: Tuesday, 11 August 2026 09:14",
          "Subject: RE: Printer",
          "",
          "Could you send a photo?"
        )
      )
    ).isEqualTo("Still broken I am afraid.");
  }

  @Test
  void appleMailWrappedHeader() {
    assertThat(
      QuotedReply.stripQuotedReply(
        lines(
          "Confirming this is resolved.",
          "",
          "On 11 Aug 2026, at 09:14, Support",
          "<support@app.test> wrote:",
          "",
          "> Any update?"
        )
      )
    ).isEqualTo("Confirming this is resolved.");
  }

  @Test
  void aBareQuoteBlockWithNoHeader() {
    assertThat(
      QuotedReply.stripQuotedReply(
        lines("Agreed.", "", "> the original question", "> second line")
      )
    ).isEqualTo("Agreed.");
  }

  @Test
  void cutsAtTheEarliestMarkerInAForwardedChain() {
    assertThat(
      QuotedReply.stripQuotedReply(
        lines(
          "Passing this on.",
          "",
          "On Tue, 11 Aug 2026, A wrote:",
          "> inner",
          "",
          "-----Original Message-----",
          "older still"
        )
      )
    ).isEqualTo("Passing this on.");
  }

  @Test
  void leavesOrdinaryProseAloneIncludingTheWordsInTheMarkers() {
    String body =
      "On Tuesday I wrote: the invoice is wrong. From: my reading of it, " +
      "the total excludes VAT.";

    assertThat(QuotedReply.stripQuotedReply(body)).isEqualTo(body);
  }

  @Test
  void returnsTheOriginalWhenStrippingWouldEmptyIt() {
    String body = lines("> only quoted text", "> and nothing else");

    assertThat(QuotedReply.stripQuotedReply(body)).isEqualTo(body);
  }

  @Test
  void dropsTheSignatureAfterAnRfc3676Delimiter() {
    assertThat(
      QuotedReply.stripQuotedReply(
        lines("The short answer is yes.", "", "-- ", "Jane", "Acme Ltd")
      )
    ).isEqualTo("The short answer is yes.");
  }

  @Test
  void htmlCutsAtGmailsQuoteContainer() {
    String html =
      "<div dir=\"ltr\">Thanks, that worked.</div>" +
      "<div class=\"gmail_quote\"><blockquote>old thread</blockquote></div>";

    assertThat(QuotedReply.stripQuotedHtml(html))
      .doesNotContain("old thread")
      .contains("that worked");
  }

  @Test
  void htmlCutsAtABareBlockquote() {
    assertThat(
      QuotedReply.stripQuotedHtml(
        "<p>Confirmed.</p><blockquote>previous</blockquote>"
      )
    ).isEqualTo("<p>Confirmed.</p>");
  }

  @Test
  void theTextPartWinsWheneverThereIsOne() {
    assertThat(
      QuotedReply.toStoredBody("the plain part", "<p>the html part</p>")
    ).isEqualTo("the plain part");
  }

  @Test
  void fallsBackToHtmlReducedToText() {
    assertThat(
      QuotedReply.toStoredBody(null, "<p>First line.</p><p>Second line.</p>")
    ).isEqualTo("First line.\nSecond line.");
  }

  @Test
  void decodesEntitiesLastSoEscapedMarkupCannotBecomeATag() {
    assertThat(
      QuotedReply.toStoredBody(null, "<p>use &lt;b&gt; for bold</p>")
    ).isEqualTo("use <b> for bold");
  }

  @Test
  void dropsScriptAndStyleContentEntirely() {
    assertThat(
      QuotedReply.toStoredBody(
        null,
        "<style>p{color:red}</style><p>Visible.</p>"
      )
    ).isEqualTo("Visible.");
  }

  @Test
  void answersEmptyForAMessageWithNeitherPart() {
    assertThat(QuotedReply.toStoredBody(null, null)).isEmpty();
    assertThat(QuotedReply.toStoredBody("   ", null)).isEmpty();
  }

  // The inputs below are sender-controlled and unbounded. As a regex, a run of
  // quoted lines is a repeated group, which Java matches recursively: it would be
  // a StackOverflowError on the thread serving the webhook.

  @Test
  void aHugeRunOfQuotedLinesIsStrippedWithoutOverflowingTheStack() {
    String body = "real\n" + "> q\n".repeat(200_000) + "tail";

    assertThat(QuotedReply.stripQuotedReply(body)).isEqualTo("real\ntail");
  }

  @Test
  void aHugeRunOfWhitespaceAndNewlinesIsLinear() {
    String body = "a" + "\n".repeat(500_000) + "b";
    String spaced = "real\nOn " + " ".repeat(100_000) + "x";

    org.junit.jupiter.api.Assertions.assertTimeoutPreemptively(
      Duration.ofSeconds(5),
      () -> {
        assertThat(QuotedReply.stripQuotedReply(body)).isEqualTo("a\n\nb");
        assertThat(QuotedReply.stripQuotedReply(spaced)).isEqualTo(spaced);
      }
    );
  }

  /**
   * The property {@link HtmlScan} exists for, measured in WORK and not in time. Each
   * shape is a body of openers that are never closed, which the regular
   * expressions rescanned from every one of, so their cost grew with the SQUARE of
   * the length. {@link HtmlScan#work} counts every step the scanners take, so the
   * count for double the input must be about double, not four times, and a scanner
   * that rescans fails here at sizes that finish in milliseconds, on any machine.
   *
   * <p>A stopwatch cannot say this: it measures the machine as much as the code (a
   * 90 ms run took 498 s when the box was swapping), and it passes a quadratic
   * scanner that happens to run fast. The input is NOT capped: linearity is the
   * scanners' own, not the body cap's. Measured on the current scanners: exactly
   * twice the work for twice the input, between 20 and 37 steps per character.
   */
  @org.junit.jupiter.params.ParameterizedTest(
    name = "{0} repeated, never closed"
  )
  @org.junit.jupiter.params.provider.ValueSource(
    strings = {
      "<b ",
      "<script",
      "<style",
      "<div ",
      "<li ",
      "<hr ",
      "<div class=\"",
      "<div class=\"gmail",
      "<blockquote",
      "<p><",
      "<",
    }
  )
  void everyUnclosedOpenerShapeIsLinearAndUncapped(String opener) {
    long small = workFor(opener, 20_000);
    long medium = workFor(opener, 40_000);
    long large = workFor(opener, 80_000);

    // Linear is x2.00 per doubling; quadratic is x4. 2.2 leaves room for the
    // input's own edges and none for a rescan.
    org.assertj.core.api.Assertions.assertThat((double) medium / small)
      .as("work for 40 000 characters over work for 20 000")
      .isLessThan(2.2);
    org.assertj.core.api.Assertions.assertThat((double) large / medium)
      .as("work for 80 000 characters over work for 40 000")
      .isLessThan(2.2);
    // And a constant that does not explode: the measured worst is 37 per character.
    org.assertj.core.api.Assertions.assertThat(large / 80_000.0)
      .as("steps per character")
      .isLessThan(100.0);
  }

  @Test
  void aLongRunOfClosedTagsIsLinearToo() {
    long small = workFor("<p>a</p><div class=\"x\">b</div><li>c</li>", 20_000);
    long large = workFor("<p>a</p><div class=\"x\">b</div><li>c</li>", 80_000);

    // Four times the input, so linear is x4 and quadratic is x16.
    org.assertj.core.api.Assertions.assertThat((double) large / small)
      .as("work for 80 000 characters over work for 20 000")
      .isLessThan(4.4);
  }

  /** Steps the scanners take on `size` characters of `unit` repeated, through both entry points. */
  private static long workFor(String unit, int size) {
    String body = "<p>" + unit.repeat(Math.max(1, size / unit.length()));

    // A hang guard only: a quadratic regression fails on the counts above long
    // before this, and the bound is wide enough that a swapping machine never
    // reaches it. Nothing here asserts a speed.
    org.junit.jupiter.api.Assertions.assertTimeoutPreemptively(
      Duration.ofMinutes(10),
      () -> {
        HtmlScan.work = 0;
        QuotedReply.toStoredBody(null, body);
        QuotedReply.stripQuotedHtml(body);
      }
    );

    return HtmlScan.work;
  }
}
