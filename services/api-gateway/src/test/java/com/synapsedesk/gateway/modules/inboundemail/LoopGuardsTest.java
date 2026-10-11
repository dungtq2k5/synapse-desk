package com.synapsedesk.gateway.modules.inboundemail;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * The pure halves of the mail-loop guards. The rows that prove the guards hold
 * the whole pipeline (no reply, no ticket, the right counter) are exercised
 * through {@code accept()} and the contract suite; these pin the predicates.
 */
class LoopGuardsTest {

  private static final String SENDER = "support@synapsedesk.test";

  @Test
  void ourOwnAddressIsSelfAddressedWhateverTheCaseOrDisplayName() {
    assertThat(
      LoopGuards.isSelfAddressed("support@synapsedesk.test", SENDER)
    ).isTrue();
    assertThat(
      LoopGuards.isSelfAddressed("SUPPORT@SynapseDesk.test", SENDER)
    ).isTrue();
    assertThat(
      LoopGuards.isSelfAddressed(
        "\"SynapseDesk Support\" <support@synapsedesk.test>",
        SENDER
      )
    ).isTrue();
  }

  @Test
  void aConfiguredSenderWithADisplayNameStillMatches() {
    assertThat(
      LoopGuards.isSelfAddressed(
        "support@synapsedesk.test",
        "SynapseDesk <Support@SynapseDesk.test>"
      )
    ).isTrue();
  }

  @Test
  void anotherAddressOrALookalikeIsNot() {
    assertThat(
      LoopGuards.isSelfAddressed("customer@acme.test", SENDER)
    ).isFalse();
    assertThat(
      LoopGuards.isSelfAddressed("support@synapsedesk.test.evil", SENDER)
    ).isFalse();
    assertThat(
      LoopGuards.isSelfAddressed(
        "\"support@synapsedesk.test\" <attacker@evil.test>",
        SENDER
      )
    ).isFalse();
  }

  @Test
  void autoSubmittedAnythingButNoIsAutomated() {
    for (String value : new String[] {
      "auto-generated",
      "auto-replied",
      "AUTO-NOTIFIED",
    }) {
      assertThat(
        LoopGuards.isAutomated(Map.of("Auto-Submitted", value))
      ).isTrue();
    }
  }

  @Test
  void autoSubmittedNoIsOrdinaryMail() {
    assertThat(
      LoopGuards.isAutomated(Map.of("Auto-Submitted", "no"))
    ).isFalse();
    assertThat(
      LoopGuards.isAutomated(Map.of("auto-submitted", "NO"))
    ).isFalse();
  }

  @Test
  void bulkListAndJunkPrecedenceAreAutomated() {
    for (String value : new String[] { "bulk", "list", "JUNK" }) {
      assertThat(LoopGuards.isAutomated(Map.of("Precedence", value))).isTrue();
    }
  }

  @Test
  void otherPrecedenceValuesAndNoHeadersAreNot() {
    assertThat(
      LoopGuards.isAutomated(Map.of("Precedence", "normal"))
    ).isFalse();
    assertThat(LoopGuards.isAutomated(Map.of("Subject", "bulk"))).isFalse();
    assertThat(LoopGuards.isAutomated(Map.of())).isFalse();
    assertThat(LoopGuards.isAutomated(null)).isFalse();
  }

  @Test
  void headerNamesMatchWhateverTheirCase() {
    Map<String, String> headers = new HashMap<>();
    headers.put("PRECEDENCE", "bulk");

    assertThat(LoopGuards.isAutomated(headers)).isTrue();
  }
}
