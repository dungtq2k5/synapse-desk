package com.synapsedesk.gateway.modules.realtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.synapsedesk.gateway.common.config.ThrottleProperties;
import com.synapsedesk.gateway.common.contracts.RealtimeEvents;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;

/**
 * The keys each limit counts, and the refusal and fail-open behavior.
 */
class WsThrottlerServiceTest {

  private final StringRedisTemplate redis = mock(StringRedisTemplate.class);

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
    /* wsHandshakeTtl */ 60_000L,
    /* wsHandshakeFailedLimit */ 3,
    /* wsHandshakeFailedTtl */ 30_000L,
    /* wsHandshakeUserLimit */ 2,
    /* wsHandshakeUserTtl */ 45_000L
  );
  private final WsThrottlerService throttler = new WsThrottlerService(
    redis,
    throttle
  );

  /** The count the script returns for {@code key}. */
  private void counted(String key, long hits) {
    when(
      redis.execute(
        eq(WsThrottlerService.COUNT),
        eq(List.of(key)),
        any(Object[].class)
      )
    ).thenReturn(hits);
  }

  @Test
  void eachLimitCountsItsOwnKeyWithItsOwnWindow() {
    counted("ws_handshake:flood:1.2.3.4", 1);
    counted("ws_handshake:failed:1.2.3.4", 1);
    counted("ws_handshake:user:user-1", 1);
    counted(
      "ws_event:" + RealtimeEvents.CLIENT_EVENTS_TYPING_START + ":user-1",
      1
    );

    assertThat(throttler.allowHandshake("1.2.3.4")).isTrue();
    assertThat(throttler.allowFailed("1.2.3.4")).isTrue();
    assertThat(throttler.allowUser("user-1")).isTrue();
    assertThat(
      throttler.allowEvent(RealtimeEvents.CLIENT_EVENTS_TYPING_START, "user-1")
    ).isTrue();

    verify(redis).execute(
      WsThrottlerService.COUNT,
      List.of("ws_handshake:flood:1.2.3.4"),
      "60000"
    );
    verify(redis).execute(
      WsThrottlerService.COUNT,
      List.of("ws_handshake:failed:1.2.3.4"),
      "30000"
    );
    verify(redis).execute(
      WsThrottlerService.COUNT,
      List.of("ws_handshake:user:user-1"),
      "45000"
    );
  }

  @Test
  void eachLimitShedsPastItsCount() {
    counted("ws_handshake:flood:1.2.3.4", 6);
    counted("ws_handshake:failed:1.2.3.4", 4);
    counted("ws_handshake:user:user-1", 3);

    assertThat(throttler.allowHandshake("1.2.3.4")).isFalse();
    assertThat(throttler.allowFailed("1.2.3.4")).isFalse();
    assertThat(throttler.allowUser("user-1")).isFalse();
  }

  @Test
  void theScriptStartsTheWindowOnTheFirstHitInTheSameStep() {
    assertThat(WsThrottlerService.COUNT.getScriptAsString())
      .contains("redis.call('INCR', KEYS[1])")
      .contains("if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end");
  }

  @Test
  void aRedisFailureAllowsEveryHandshakeAndEventWithTheFailOpenLine() {
    when(
      redis.execute(
        eq(WsThrottlerService.COUNT),
        anyList(),
        any(Object[].class)
      )
    ).thenThrow(new RuntimeException("down"));
    Logger logger = (Logger) LoggerFactory.getLogger(WsThrottlerService.class);
    ListAppender<ILoggingEvent> logged = new ListAppender<>();
    logged.start();
    // Tests run with logging OFF; this row reads the line, so it turns it on.
    Level before = logger.getLevel();
    logger.setLevel(Level.ERROR);
    logger.addAppender(logged);
    List<Boolean> answers;
    try {
      answers = List.of(
        throttler.allowHandshake("1.2.3.4"),
        throttler.allowFailed("1.2.3.4"),
        throttler.allowUser("user-1"),
        throttler.allowEvent(
          RealtimeEvents.CLIENT_EVENTS_TYPING_START,
          "user-1"
        )
      );
    } finally {
      logger.detachAppender(logged);
      logger.setLevel(before);
    }

    assertThat(answers).containsOnly(true);
    // The line `FAIL_OPEN_LINES` names, once per call.
    assertThat(logged.list)
      .hasSize(4)
      .allSatisfy(event ->
        assertThat(event.getFormattedMessage()).startsWith(
          "WS rate-limit storage unavailable"
        )
      );
  }

  @Test
  void aMissingCountIsAFailureToo() {
    when(
      redis.execute(eq(WsThrottlerService.COUNT), anyList(), anyString())
    ).thenReturn(null);

    assertThat(throttler.allowHandshake("1.2.3.4")).isTrue();
  }
}
