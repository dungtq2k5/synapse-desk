package com.synapsedesk.gateway.realtime;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** `realtime.contract.ts`'s five room-name formats, byte-for-byte. */
class RealtimeRoomsTest {

  @Test
  void everyRoomFormatMatchesNodeExactly() {
    assertThat(RealtimeRooms.userRoom("u-1")).isEqualTo("user:u-1");
    assertThat(RealtimeRooms.orgRoom("o-1")).isEqualTo("org:o-1");
    assertThat(RealtimeRooms.ticketRoom("t-1")).isEqualTo("ticket:t-1");
    assertThat(RealtimeRooms.ticketInternalRoom("t-1")).isEqualTo(
      "ticket:t-1:internal"
    );
    assertThat(RealtimeRooms.deptRoom("d-1")).isEqualTo("dept:d-1");
  }
}
