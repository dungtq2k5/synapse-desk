package com.synapsedesk.gateway.realtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.synapsedesk.gateway.config.ThrottleProperties;
import com.synapsedesk.gateway.contracts.RealtimeEvents;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

/**
 * The key formats and refusal behaviour — key-format parity is the whole
 * bar here (see the class docblock on {@link WsThrottlerService}).
 */
class WsThrottlerServiceTest {

  private final StringRedisTemplate redis = mock(StringRedisTemplate.class);

  @SuppressWarnings("unchecked")
  private final ValueOperations<String, String> values = mock(
    ValueOperations.class
  );

  private final ThrottleProperties throttle = new ThrottleProperties(
    1000L,
    10,
    1000L,
    10,
    1000L,
    10,
    1000L,
    10,
    /* wsHandshakeLimit */ 5,
    /* wsHandshakeTtl */ 60_000L
  );
  private final WsThrottlerService throttler = new WsThrottlerService(
    redis,
    throttle
  );

  {
    when(redis.opsForValue()).thenReturn(values);
  }

  @Test
  void allowHandshakeUsesThisImplementationsOwnIdentityNeverNodesClassName() {
    when(
      values.increment("ws_handshake:java-realtime-gateway:1.2.3.4")
    ).thenReturn(1L);

    assertThat(throttler.allowHandshake("1.2.3.4")).isTrue();
    verify(values).increment("ws_handshake:java-realtime-gateway:1.2.3.4");
    // Never the class name as the key's identity.
    verify(values, never()).increment("ws_handshake:RealtimeGateway:1.2.3.4");
  }

  @Test
  void handshakeShedsPastTheLimitAndNeverBlocks() {
    // Refused, and the window is NOT extended: the next handshake after it
    // moves on succeeds. A block would hold a whole NAT'd office out after a
    // switch drops every socket at once.
    when(values.increment(anyString())).thenReturn(6L);

    assertThat(throttler.allowHandshake("1.2.3.4")).isFalse();
    verify(redis, never()).expire(anyString(), any(Duration.class));
  }

  @Test
  void eventKeyIsExactlyEventColonSubjectShared() {
    when(
      values.increment(
        "ws_event:" + RealtimeEvents.CLIENT_EVENTS_TYPING_START + ":user-1"
      )
    ).thenReturn(1L);

    assertThat(
      throttler.allowEvent(RealtimeEvents.CLIENT_EVENTS_TYPING_START, "user-1")
    ).isTrue();
  }

  @Test
  void eventThrottleRefusesWithNoBlockDuration() {
    when(values.increment(anyString())).thenReturn(1000L);

    assertThat(
      throttler.allowEvent(RealtimeEvents.CLIENT_EVENTS_TYPING_START, "user-1")
    ).isFalse();
    // Exceeding an event budget is normal: no lockout.
    verify(redis, never()).expire(anyString(), any(Duration.class));
  }

  @Test
  void failsOpenWhenRedisIsUnreachable() {
    when(values.increment(anyString())).thenThrow(new RuntimeException("down"));

    assertThat(throttler.allowHandshake("1.2.3.4")).isTrue();
    assertThat(
      throttler.allowEvent(RealtimeEvents.CLIENT_EVENTS_TYPING_START, "user-1")
    ).isTrue();
  }

  @Test
  void ttlIsSetOnlyOnTheFirstHit() {
    when(values.increment(anyString())).thenReturn(2L);

    throttler.allowHandshake("1.2.3.4");

    verify(redis, times(0)).expire(anyString(), eq(Duration.ofMillis(60_000L)));
  }
}
