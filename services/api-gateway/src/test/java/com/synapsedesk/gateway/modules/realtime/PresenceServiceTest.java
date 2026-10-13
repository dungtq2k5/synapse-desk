package com.synapsedesk.gateway.modules.realtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import tools.jackson.databind.ObjectMapper;

/**
 * `PresenceService`'s pure logic against a mocked Redis — the NX-on-connect
 * rule, the changed-detection `set` reports, and the fail-open behaviour
 * every Redis-backed class in this gateway shares.
 */
class PresenceServiceTest {

  private static final ObjectMapper JSON = new ObjectMapper();
  private static final String ORG = "org-1";
  private static final String USER = "user-1";

  private final StringRedisTemplate redis = mock(StringRedisTemplate.class);

  @SuppressWarnings("unchecked")
  private final ValueOperations<String, String> values = mock(
    ValueOperations.class
  );

  private final PresenceService presence = new PresenceService(redis, JSON);

  {
    when(redis.opsForValue()).thenReturn(values);
  }

  @Test
  void onConnectSetsOnlineWhenNothingIsRecorded() {
    when(
      values.setIfAbsent(
        eq("presence:org-1:user-1"),
        anyString(),
        any(Duration.class)
      )
    ).thenReturn(true);

    assertThat(presence.onConnect(ORG, USER)).isEqualTo("online");
  }

  @Test
  void onConnectPreservesAnExistingBusyAndRefreshesTtl() {
    when(
      values.setIfAbsent(
        eq("presence:org-1:user-1"),
        anyString(),
        any(Duration.class)
      )
    ).thenReturn(false);

    // Nothing set by this connection, so nothing to announce; `busy` stays.
    assertThat(presence.onConnect(ORG, USER)).isNull();
    verify(redis).expire(eq("presence:org-1:user-1"), any(Duration.class));
  }

  @Test
  void onConnectReturnsNullWhenRedisIsUnreachable() {
    when(
      values.setIfAbsent(anyString(), anyString(), any(Duration.class))
    ).thenThrow(new RuntimeException("down"));

    assertThat(presence.onConnect(ORG, USER)).isNull();
  }

  @Test
  void setReportsChangedOnlyWhenTheStateActuallyDiffers() {
    when(values.get("presence:org-1:user-1")).thenReturn(
      "{\"state\":\"online\",\"updatedAt\":\"2026-01-01T00:00:00Z\"}"
    );

    PresenceService.Update sameState = presence.set(ORG, USER, "online");
    assertThat(sameState.changed()).isFalse();

    PresenceService.Update newState = presence.set(ORG, USER, "busy");
    assertThat(newState.changed()).isTrue();
    assertThat(newState.state()).isEqualTo("busy");
  }

  @Test
  void setFailsOpenAndReportsUnchangedWhenRedisIsUnreachable() {
    when(values.get(anyString())).thenThrow(new RuntimeException("down"));

    PresenceService.Update result = presence.set(ORG, USER, "away");

    assertThat(result.changed()).isFalse();
    assertThat(result.state()).isEqualTo("away");
  }

  @Test
  void readReturnsNullForAMalformedRecord() {
    when(values.get("presence:org-1:user-1")).thenReturn("not json");

    assertThat(presence.read(ORG, USER)).isNull();
  }

  @Test
  void readReturnsNullForAnAbsentKey() {
    when(values.get("presence:org-1:user-1")).thenReturn(null);

    assertThat(presence.read(ORG, USER)).isNull();
  }

  @Test
  void readReturnsNullForAnUnrecognisedState() {
    when(values.get("presence:org-1:user-1")).thenReturn(
      "{\"state\":\"lunch\",\"updatedAt\":\"2026-01-01T00:00:00Z\"}"
    );

    assertThat(presence.read(ORG, USER)).isNull();
  }
}
