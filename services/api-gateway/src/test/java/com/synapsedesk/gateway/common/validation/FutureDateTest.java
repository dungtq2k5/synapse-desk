package com.synapsedesk.gateway.common.validation;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.time.OffsetDateTime;
import org.junit.jupiter.api.Test;

/** {@link FutureDate}: later than now, compared as instants whatever the offset. */
class FutureDateTest {

  private static final Instant NOW = Instant.parse("2026-10-09T00:00:00Z");

  @Test
  void anInstantAfterNowPassesAndOneAtOrBeforeNowDoesNot() {
    assertThat(
      FutureDate.Validator.isAfter(
        OffsetDateTime.parse("2999-01-01T00:00:00Z"),
        NOW
      )
    ).isTrue();
    assertThat(
      FutureDate.Validator.isAfter(
        OffsetDateTime.parse("2026-10-09T00:00:00Z"),
        NOW
      )
    ).isFalse();
    assertThat(
      FutureDate.Validator.isAfter(
        OffsetDateTime.parse("2000-01-01T00:00:00Z"),
        NOW
      )
    ).isFalse();
  }

  @Test
  void theOffsetIsHonouredRatherThanTheWallClock() {
    // 06:00 at +07:00 is 23:00 the day before in UTC: past, though its wall clock
    // reads later than NOW's.
    assertThat(
      FutureDate.Validator.isAfter(
        OffsetDateTime.parse("2026-10-09T06:00:00+07:00"),
        NOW
      )
    ).isFalse();
  }
}
