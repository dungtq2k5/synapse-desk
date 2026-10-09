package com.synapsedesk.gateway.inbound;

import static org.assertj.core.api.Assertions.assertThat;

import com.synapsedesk.gateway.inbound.ResendInboundMapper.Mapped;
import com.synapsedesk.gateway.inbound.ResendPayloads.Attachment;
import com.synapsedesk.gateway.inbound.ResendPayloads.Email;
import com.synapsedesk.gateway.inbound.ResendPayloads.Event;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

/**
 * Resend's two objects → the mail {@code accept()} takes, example by example.
 *
 * <p><b>Hand-built, not captured</b> — no inbound mail has been received on a
 * real account yet. Replace with a recorded {@code email.received} event and
 * fetch response when one exists; a recorded shape can disagree with the mapper,
 * which is the point.
 */
class ResendInboundMapperTest {

  private static final String DOMAIN = "inbound.synapsedesk.test";
  private static final String TENANT =
    "support+a1b2c3d4e5f60718293a4b5c6d7e8f90@" + DOMAIN;

  private static final Validator VALIDATOR =
    Validation.buildDefaultValidatorFactory().getValidator();

  private static Event event(String createdAt) {
    return new Event(
      "email.received",
      createdAt,
      new Event.Data("e-1", List.of(TENANT))
    );
  }

  private static Event event() {
    return event("2026-09-15T10:00:00.000Z");
  }

  /** A fetched mail with defaults, adjusted by what a row cares about. */
  private static final class MailBuilder {

    String from = "Ada Lovelace <ada@acme.test>";
    String subject = "Printer";
    String text = "It is on fire.";
    String html = null;
    String messageId = "<m-1@acme.test>";
    List<String> receivedFor = List.of(TENANT);
    Map<String, String> headers = Map.of();
    List<Attachment> attachments = List.of();

    MailBuilder from(String value) {
      from = value;
      return this;
    }

    MailBuilder text(String value) {
      text = value;
      return this;
    }

    MailBuilder html(String value) {
      html = value;
      return this;
    }

    MailBuilder messageId(String value) {
      messageId = value;
      return this;
    }

    MailBuilder receivedFor(String... value) {
      receivedFor = List.of(value);
      return this;
    }

    MailBuilder headers(Map<String, String> value) {
      headers = value;
      return this;
    }

    MailBuilder noHeaders() {
      headers = null;
      return this;
    }

    MailBuilder attachments(List<Attachment> value) {
      attachments = value;
      return this;
    }

    Email build() {
      return new Email(
        from,
        subject,
        text,
        html,
        messageId,
        receivedFor,
        headers,
        attachments
      );
    }
  }

  private static MailBuilder mail() {
    return new MailBuilder();
  }

  private static Mapped map(MailBuilder mail) {
    return ResendInboundMapper.toMapped(event(), mail.build(), DOMAIN);
  }

  private static InboundEmail fields(MailBuilder mail) {
    return map(mail).fields();
  }

  private static Set<String> violatedProperties(InboundEmail email) {
    Set<String> names = new TreeSet<>();
    for (ConstraintViolation<InboundEmail> violation : VALIDATOR.validate(
      email
    )) {
      names.add(
        violation.getPropertyPath().toString().replaceAll("[\\[.].*", "")
      );
    }

    return names;
  }

  // ----------------------------------------------------------- the recipient

  @Test
  void theRecipientComesFromReceivedForNotTheToHeader() {
    // A mail that reached the tenant address by BCC or through a list names
    // somebody else in `To:`; only the envelope says it was for us.
    assertThat(fields(mail().receivedFor(TENANT)).to()).isEqualTo(TENANT);
  }

  @Test
  void noEntryOnTheInboundDomainIsEmptyWhichNothingRoutes() {
    // `parseInboundAddress` ignores the domain, so passing the foreign address
    // through would route `support+token@elsewhere` to the tenant.
    Mapped mapped = map(
      mail().receivedFor(
        "support+a1b2c3d4e5f60718293a4b5c6d7e8f90@elsewhere.test"
      )
    );

    assertThat(mapped.fields().to()).isEmpty();
    assertThat(mapped.tenantRecipientCount()).isZero();
  }

  @Test
  void twoTenantAddressesIsTheFirstAndTheCountSaysTwo() {
    String second = "support+ffffffffffffffffffffffffffffffff@" + DOMAIN;
    Mapped mapped = map(
      mail().receivedFor("someone@acme.test", TENANT, second)
    );

    assertThat(mapped.fields().to()).isEqualTo(TENANT);
    assertThat(mapped.tenantRecipientCount()).isEqualTo(2);
  }

  @Test
  void matchesTheDomainCaseInsensitivelyAndTakesABracketedEntry() {
    assertThat(
      fields(mail().receivedFor("Support <" + TENANT.toUpperCase() + ">")).to()
    ).isEqualTo(TENANT);
  }

  // -------------------------------------------------------------- the sender

  @ParameterizedTest
  @CsvSource(
    delimiter = '|',
    nullValues = "NULL",
    value = {
      "Ada Lovelace <ada@acme.test>|ada@acme.test|Ada Lovelace",
      "\"Lovelace, Ada\" <ada@acme.test>|ada@acme.test|'Lovelace, Ada'",
      "ada@acme.test|ada@acme.test|NULL",
      "<ada@acme.test>|ada@acme.test|NULL",
    }
  )
  void splitsTheSenderIntoAddressAndName(
    String from,
    String address,
    String name
  ) {
    InboundEmail fields = fields(mail().from(from));

    assertThat(fields.from()).isEqualTo(address);
    assertThat(fields.fromName()).isEqualTo(
      name == null ? null : name.replace("'", "")
    );
  }

  @Test
  void aQuotedDisplayNameContainingALineTerminatorKeepsItsQuotesAsInNode() {
    // `/^"(.*)"$/`: `.` stops at a line terminator, so the regex does not match.
    assertThat(
      fields(mail().from("\"a\nb\" <ada@acme.test>")).fromName()
    ).isEqualTo("\"a\nb\"");
  }

  // ------------------------------------------------------------- the headers

  @Test
  void forwardsOnlyAutoSubmittedAndPrecedenceWhateverTheCasing() {
    Map<String, String> headers = new LinkedHashMap<>();
    headers.put("Auto-Submitted", "auto-replied");
    headers.put("PRECEDENCE", "bulk");
    headers.put("X-Mailer", "something the guards never read");
    headers.put("Received", "from somewhere");

    assertThat(fields(mail().headers(headers)).headers()).containsOnly(
      Map.entry("auto-submitted", "auto-replied"),
      Map.entry("precedence", "bulk")
    );
  }

  @Test
  void noLoopHeadersMeansNoHeadersAtAll() {
    assertThat(fields(mail()).headers()).isNull();
  }

  @Test
  void headersNullDegradesRatherThanThrows() {
    InboundEmail fields = fields(mail().noHeaders());

    assertThat(fields.inReplyTo()).isNull();
    assertThat(fields.references()).isEmpty();
    assertThat(fields.headers()).isNull();
  }

  @Test
  void threadingReadsInReplyToReferencesSplitOnFoldedWhitespaceAndDate() {
    InboundEmail fields = fields(
      mail().headers(
        Map.of(
          "In-Reply-To",
          " <a@synapsedesk.test> ",
          "References",
          "<a@synapsedesk.test>\r\n <b@synapsedesk.test>\t<c@x>",
          "Date",
          "Tue, 15 Sep 2026 10:00:00 +0000"
        )
      )
    );

    assertThat(fields.inReplyTo()).isEqualTo("<a@synapsedesk.test>");
    assertThat(fields.references()).containsExactly(
      "<a@synapsedesk.test>",
      "<b@synapsedesk.test>",
      "<c@x>"
    );
    assertThat(fields.date()).isEqualTo("Tue, 15 Sep 2026 10:00:00 +0000");
  }

  @Test
  void aNoBreakSpaceSeparatesReferencesAsItDoesInJavaScript() {
    // JS `\s` and `trim()` count U+00A0 and the BOM as whitespace; Java's
    // `trim()`, `strip()` and `\s` each treat them differently. A sender-
    // controlled header is where the difference would show.
    InboundEmail fields = fields(
      mail().headers(Map.of("References", "﻿<a@x> <b@x> "))
    );

    assertThat(fields.references()).containsExactly("<a@x>", "<b@x>");
  }

  @Test
  void anEmptyHeaderIsAbsentNotEmpty() {
    assertThat(
      fields(mail().headers(Map.of("In-Reply-To", "   "))).inReplyTo()
    ).isNull();
  }

  // ---------------------------------------------------------- identity, body

  @Test
  void messageIdIsTheTopLevelMessageIdAndEmptyIsAbsent() {
    assertThat(fields(mail()).messageId()).isEqualTo("<m-1@acme.test>");
    assertThat(fields(mail().messageId("")).messageId()).isNull();
  }

  @Test
  void receivedAtIsTheEventsCreatedAt() {
    InboundEmail fields = ResendInboundMapper.toMapped(
      event("2026-09-15T10:00:07.123Z"),
      mail().build(),
      DOMAIN
    ).fields();

    assertThat(fields.receivedAt()).isEqualTo("2026-09-15T10:00:07.123Z");
  }

  @Test
  void textAndHtmlPassThroughNullIncluded() {
    InboundEmail fields = fields(mail().text(null).html("<p>hi</p>"));

    assertThat(fields.text()).isNull();
    assertThat(fields.html()).isEqualTo("<p>hi</p>");
  }

  // ------------------------------------------------------------- attachments

  private static Attachment file(
    String id,
    String filename,
    long size,
    String type,
    String contentId,
    String disposition
  ) {
    return new Attachment(id, filename, size, type, contentId, disposition);
  }

  private static Attachment png(String id) {
    return file(id, "screenshot.png", 10, "image/png", null, "attachment");
  }

  private static InboundEmail split(Attachment... attachments) {
    return fields(mail().attachments(List.of(attachments)));
  }

  @Test
  void anAllowedTypeBecomesARemoteAttachmentWithoutAUrl() {
    InboundEmail fields = split(png("a-1"));

    assertThat(fields.remoteAttachments()).containsExactly(
      new InboundEmail.RemoteAttachment(
        "a-1",
        "screenshot.png",
        "image/png",
        10
      )
    );
    assertThat(fields.droppedAttachments()).isEmpty();
    assertThat(fields.attachments()).isEmpty();
  }

  @Test
  void aTypeOutsideTheAllowlistIsDroppedByName() {
    InboundEmail fields = split(
      file("a", "setup.exe", 10, "application/x-msdownload", null, "attachment")
    );

    assertThat(fields.remoteAttachments()).isEmpty();
    assertThat(fields.droppedAttachments()).containsExactly("setup.exe");
  }

  @Test
  void anInlineImageWithAContentIdIsDroppedBecauseItIsPartOfTheHtml() {
    InboundEmail fields = split(
      file("logo", "logo.png", 10, "image/png", "logo@x", "inline"),
      // Inline WITHOUT a content id is not referenced by the HTML, so it is a
      // file the sender attached.
      file("kept", "photo.png", 10, "image/png", null, "inline")
    );

    assertThat(fields.droppedAttachments()).containsExactly("logo.png");
    assertThat(fields.remoteAttachments())
      .extracting(InboundEmail.RemoteAttachment::id)
      .containsExactly("kept");
  }

  @Test
  void aNullFilenameIsUnnamedOnEitherSide() {
    InboundEmail fields = split(
      file("kept", null, 10, "image/png", null, "attachment"),
      file("x", null, 10, "application/zip", null, "attachment")
    );

    assertThat(fields.remoteAttachments().get(0).fileName()).isEqualTo(
      ResendInboundMapper.UNNAMED_ATTACHMENT
    );
    assertThat(fields.droppedAttachments()).containsExactly(
      ResendInboundMapper.UNNAMED_ATTACHMENT
    );
  }

  @Test
  void twentyOneEligibleAttachmentsKeepTwentyAndNameTheTwentyFirst() {
    Attachment[] many = IntStream.range(0, 21)
      .mapToObj(i ->
        file("a-" + i, "f-" + i + ".png", 10, "image/png", null, "attachment")
      )
      .toArray(Attachment[]::new);
    InboundEmail fields = split(many);

    assertThat(fields.remoteAttachments()).hasSize(20);
    assertThat(fields.droppedAttachments()).containsExactly("f-20.png");
  }

  @Test
  void aParameterisedContentTypeIsNormalisedAndKept() {
    InboundEmail fields = split(
      file("a", "a.png", 10, "Image/PNG; name=\"a.png\"", null, "attachment")
    );

    assertThat(fields.remoteAttachments())
      .extracting(InboundEmail.RemoteAttachment::mimeType)
      .containsExactly("image/png");
  }

  @Test
  void aZeroByteFileIsDropped() {
    InboundEmail fields = split(
      file("a", "empty.png", 0, "image/png", null, "attachment")
    );

    assertThat(fields.remoteAttachments()).isEmpty();
    assertThat(fields.droppedAttachments()).containsExactly("empty.png");
  }

  @Test
  void aTwoHundredFiftySixCharacterNameIsDroppedAndTruncatedWithAnEllipsisInTheNote() {
    String longName = "n".repeat(252) + ".png";
    InboundEmail fields = split(
      file("a", longName, 10, "image/png", null, "attachment")
    );

    assertThat(fields.remoteAttachments()).isEmpty();
    assertThat(fields.droppedAttachments()).hasSize(1);
    assertThat(fields.droppedAttachments().get(0)).hasSize(255).endsWith("…");
  }

  @Test
  void aMailCarryingAllTheSplitCasesStillPassesValidation() {
    List<Attachment> all = new ArrayList<>();
    all.add(
      file("a", "a.png", 10, "image/png; name=\"a.png\"", null, "attachment")
    );
    all.add(file("b", "b.png", 0, "image/png", null, "attachment"));
    all.add(
      file("c", "n".repeat(300) + ".png", 10, "image/png", null, "attachment")
    );
    IntStream.range(0, 22).forEach(i -> all.add(png("x-" + i)));

    assertThat(violatedProperties(fields(mail().attachments(all)))).isEmpty();
  }

  // ---------------------------------------------------------- against the DTO

  @Test
  void aWellFormedMailPassesTheSameValidationThePipeApplies() {
    InboundEmail email = fields(
      mail().headers(
        Map.of(
          "In-Reply-To",
          "<a@x>",
          "References",
          "<a@x> <b@x>",
          "Auto-Submitted",
          "no"
        )
      )
    );

    assertThat(violatedProperties(email)).isEmpty();
  }

  @Test
  void anOverLongMessageIdFromResendIsRefused() {
    // The mapper passes it through untouched; the explicit validation is what
    // stops it before a VarChar(255) unique index does.
    assertThat(
      violatedProperties(
        fields(mail().messageId("<" + "a".repeat(300) + "@x>"))
      )
    ).containsExactly("messageId");
  }
}
