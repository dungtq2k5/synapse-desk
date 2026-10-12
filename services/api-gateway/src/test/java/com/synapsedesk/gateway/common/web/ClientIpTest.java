package com.synapsedesk.gateway.common.web;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** {@link ClientIp}: the rightmost non-blank X-Forwarded-For entry, else the peer. */
class ClientIpTest {

  private static final String PEER = "10.0.0.5";

  @Test
  void noHeaderIsThePeer() {
    assertThat(ClientIp.of(null, PEER)).isEqualTo(PEER);
    assertThat(ClientIp.of("", PEER)).isEqualTo(PEER);
  }

  @Test
  void oneEntryIsThatEntry() {
    assertThat(ClientIp.of("203.0.113.9", PEER)).isEqualTo("203.0.113.9");
  }

  @Test
  void severalEntriesAreTheRightmostOneTheTrustedHopAppended() {
    assertThat(
      ClientIp.of("198.51.100.7, 192.0.2.1, 203.0.113.9", PEER)
    ).isEqualTo("203.0.113.9");
  }

  @Test
  void blankEntriesAreSkippedAndWhitespaceIsTrimmed() {
    assertThat(ClientIp.of("198.51.100.7,  203.0.113.9 , ,", PEER)).isEqualTo(
      "203.0.113.9"
    );
    assertThat(ClientIp.of(" , ", PEER)).isEqualTo(PEER);
  }

  @Test
  void noHeaderAndNoPeerIsEmptyNeverNull() {
    assertThat(ClientIp.of(null, null)).isEmpty();
  }
}
