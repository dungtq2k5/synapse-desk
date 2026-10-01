package com.synapsedesk.gateway.inbound;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import org.junit.jupiter.api.Test;

/**
 * Quoted history is stripped and the new text survives — the Node gateway's
 * {@code quoted-reply.spec.ts}, row for row, plus the one thing a Java port can
 * fail at that the original cannot: input size.
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

  // The inputs below are sender-controlled and unbounded. The Node pattern for a
  // run of quoted lines is a repeated group, which Java matches recursively: here
  // it would be a StackOverflowError on the thread serving the webhook.

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
   * The property {@link HtmlScan} exists for. Each shape is a body of openers that
   * are never closed, which the regular expressions rescanned from every one of:
   * 800 000 characters took them about ten minutes in Java. This uses 3 000 000,
   * because the JDK's vectorised {@code indexOf} hides a rescan at smaller sizes.
   * The bound is generous (five seconds) and the input is NOT capped — linearity is the scanners' own,
   * not the cap's.
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
      "<p><",
    }
  )
  void everyUnclosedOpenerShapeIsLinearAndUncapped(String opener) {
    String hostile = "<p>" + opener.repeat(3_000_000 / opener.length());

    org.junit.jupiter.api.Assertions.assertTimeoutPreemptively(
      Duration.ofSeconds(5),
      () -> {
        QuotedReply.toStoredBody(null, hostile);
        QuotedReply.stripQuotedHtml(hostile);
      }
    );
  }

  @Test
  void aLongRunOfClosedTagsIsLinearToo() {
    String tags = "<p>a</p><div class=\"x\">b</div><li>c</li>".repeat(20_000);

    org.junit.jupiter.api.Assertions.assertTimeoutPreemptively(
      Duration.ofSeconds(5),
      () -> QuotedReply.toStoredBody(null, tags)
    );
  }
}
