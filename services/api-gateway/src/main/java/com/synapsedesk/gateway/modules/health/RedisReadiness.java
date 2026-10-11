package com.synapsedesk.gateway.modules.health;

import com.synapsedesk.gateway.modules.health.dto.rest.ReadinessDependenciesResponseDto;
import com.synapsedesk.gateway.modules.health.dto.rest.ReadinessDependenciesResponseDto.RedisEnum;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/**
 * Reports Redis under {@code dependencies.redis}, and never gates on it.
 *
 * <p>Every replica shares one Redis, so a Redis outage gated on would take every
 * replica out at once — ADR 0010's rule for a peer. And nothing needs it to serve:
 * the response cache, the rate limits, the tenant status and presence each degrade
 * without it. So {@link #isReady} is always true and Redis is only reported.
 *
 * <p>{@code UP} when a ping answers, {@code DOWN} when it fails, {@code UNKNOWN}
 * when it has not answered within {@link #PING_TIMEOUT}: a probe must not wait on
 * the client's own command timeout.
 */
@Component
public class RedisReadiness implements ReadinessGate {

  static final Duration PING_TIMEOUT = Duration.ofMillis(500);

  private final StringRedisTemplate redis;

  private final ExecutorService pings = Executors.newSingleThreadExecutor(
    task -> {
      Thread thread = new Thread(task, "redis-readiness");
      thread.setDaemon(true);
      return thread;
    }
  );

  public RedisReadiness(StringRedisTemplate redis) {
    this.redis = redis;
  }

  @Override
  public boolean isReady() {
    return true;
  }

  @Override
  public void report(
    ReadinessDependenciesResponseDto dependencies,
    boolean ready
  ) {
    dependencies.redis(state());
  }

  RedisEnum state() {
    CompletableFuture<String> ping = CompletableFuture.supplyAsync(
      () -> redis.execute(connection -> connection.ping(), true),
      pings
    );
    try {
      return "PONG".equalsIgnoreCase(
        ping.get(PING_TIMEOUT.toMillis(), TimeUnit.MILLISECONDS)
      )
        ? RedisEnum.UP
        : RedisEnum.DOWN;
    } catch (TimeoutException slow) {
      ping.cancel(true);
      return RedisEnum.UNKNOWN;
    } catch (InterruptedException interrupted) {
      Thread.currentThread().interrupt();
      return RedisEnum.UNKNOWN;
    } catch (java.util.concurrent.ExecutionException failed) {
      return RedisEnum.DOWN;
    }
  }
}
