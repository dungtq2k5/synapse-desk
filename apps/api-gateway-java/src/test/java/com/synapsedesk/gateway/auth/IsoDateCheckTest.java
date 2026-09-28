package com.synapsedesk.gateway.auth;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

/**
 * The one shared copy of Node's {@code @IsISO8601({strict: true})}, now used
 * by all four call sites that used to carry their own. See the class
 * docblock for why both a bare date and a full timestamp must pass.
 */
class IsoDateCheckTest {

  @Test
  void refusesAMalformedDate() {
    assertThatThrownBy(() ->
      IsoDateCheck.requireIsoDate("not-a-date", "from")
    ).isInstanceOf(ResponseStatusException.class);
  }

  @Test
  void acceptsABareCalendarDate() {
    assertThatCode(() ->
      IsoDateCheck.requireIsoDate("2026-01-01", "from")
    ).doesNotThrowAnyException();
  }

  @Test
  void acceptsAFullIsoTimestamp() {
    assertThatCode(() ->
      IsoDateCheck.requireIsoDate("2026-01-01T00:00:00Z", "from")
    ).doesNotThrowAnyException();
  }
}
