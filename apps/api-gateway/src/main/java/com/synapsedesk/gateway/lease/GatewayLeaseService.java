package com.synapsedesk.gateway.lease;

import com.synapsedesk.gateway.model.ReadinessDependenciesResponseDto;
import com.synapsedesk.gateway.ops.ReadinessGate;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.SmartLifecycle;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

/**
 * A Redis-held lease that gates readiness and the NATS consumers: a pod is
 * ready, and consumes, only while it holds an entry.
 *
 * <p><b>A standby, not a refusal.</b> A pod without the lease boots, warms,
 * answers `/health` so the kubelet leaves it alone, and answers
 * `/health/ready` with 503 so the Service sends it nothing — while consuming
 * no NATS subject and accepting no socket. It claims on its next beat.
 *
 * <p><b>Per pod.</b> With `replicas: 2` a single shared key would be deleted
 * by the first pod to exit while the second is still consuming. Each pod
 * holds its own entry in `gateway:holders:java`, and claims only while
 * `gateway:holders:node` ({@link GatewayLease#OTHER}) has no unexpired entry.
 * Nothing in this deployment writes that set, so every pod claims on its
 * first beat; a pod whose entry is lost or fenced steps down and stands by.
 *
 * <p>{@link GatewayLease} holds the keys, scripts and timings.
 */
@Component
public class GatewayLeaseService implements ReadinessGate, SmartLifecycle {

  private static final Logger LOG = LoggerFactory.getLogger(
    GatewayLeaseService.class
  );

  private static final DefaultRedisScript<Long> CLAIM =
    new DefaultRedisScript<>(GatewayLease.CLAIM, Long.class);

  private static final DefaultRedisScript<Long> EXTEND =
    new DefaultRedisScript<>(GatewayLease.REFRESH_SCRIPT, Long.class);

  /** This process's entry. Unique per pod AND per restart. */
  private final String podId;

  private final StringRedisTemplate redis;
  private final LeaseRuntime runtime;
  private final AtomicBoolean active = new AtomicBoolean();
  private final AtomicBoolean stopping = new AtomicBoolean();
  private final AtomicBoolean started = new AtomicBoolean();

  /** Built per start: a stopped executor cannot be restarted. */
  private volatile java.util.concurrent.ScheduledExecutorService beats =
    newBeats();

  private static java.util.concurrent.ScheduledExecutorService newBeats() {
    return java.util.concurrent.Executors.newSingleThreadScheduledExecutor(
      runnable -> {
        Thread thread = new Thread(runnable, "gateway-lease");
        thread.setDaemon(true);

        return thread;
      }
    );
  }

  private volatile long lastRefreshAt;

  public GatewayLeaseService(StringRedisTemplate redis, LeaseRuntime runtime) {
    this.redis = redis;
    this.runtime = runtime;
    this.podId = "%s:%d:%s".formatted(
      host(),
      ProcessHandle.current().pid(),
      shortId()
    );
  }

  /** True only while this process holds the lease — what readiness reports. */
  public boolean isActive() {
    return active.get();
  }

  /** This process's entry, for a log line. Never a decision. */
  public String podId() {
    return podId;
  }

  @Override
  public boolean isReady() {
    return isActive();
  }

  @Override
  public void report(
    ReadinessDependenciesResponseDto dependencies,
    boolean ready
  ) {
    // The lease does not appear under `dependencies` — that object's fields
    // come from the published API document, and adding one would change it.
    // `ready` already says whether to route here, which is the field a
    // Service reads.
  }

  /**
   * Starts beating, immediately and then every {@link GatewayLease#REFRESH}.
   *
   * <p><b>Its own scheduler, not `@Scheduled`.</b> Measured: a
   * `fixedRateString` of `#{@gatewayLeaseService.refreshMillis}` makes the
   * bean depend on itself and Spring refuses the context with a cycle. A
   * literal interval would put the timing contract in two places, so the
   * interval stays in {@link GatewayLease} and the schedule is built from it
   * here.
   *
   * <p>The thread is a DAEMON: a gateway whose only remaining work is this
   * timer should exit.
   *
   * <p>A lifecycle start, in {@link #PHASE}, so it begins after the Redis
   * connection factory (phase 0) has started. Restartable: Spring stops and
   * restarts a context's lifecycle beans (a cached test context is paused while
   * unused), so a start after a stop claims again on a fresh scheduler.
   */
  @Override
  public void start() {
    if (beats.isShutdown()) beats = newBeats();
    stopping.set(false);
    started.set(true);
    beats.scheduleAtFixedRate(
      this::beat,
      0,
      GatewayLease.REFRESH.toMillis(),
      java.util.concurrent.TimeUnit.MILLISECONDS
    );
  }

  /**
   * One beat: claim while standing by, refresh while active, fence if the
   * refresh has not succeeded for {@link GatewayLease#FENCE}.
   */
  public void beat() {
    if (stopping.get()) {
      return;
    }

    try {
      long now = System.currentTimeMillis();

      if (!active.get()) {
        if (claim(now)) {
          becomeActive();
        }

        return;
      }

      if (extend(now)) {
        lastRefreshAt = now;

        return;
      }

      LOG.warn("Lease entry is gone — stepping down");
      stepDown();
    } catch (RuntimeException failure) {
      // Redis unreachable, or a script failure. Readiness already reports 503
      // for an unreachable Redis; what that does NOT stop is this process
      // consuming and holding sockets, which is what the fence is for.
      LOG.warn("Lease beat failed: {}", failure.getMessage());

      if (
        active.get() &&
        System.currentTimeMillis() - lastRefreshAt >
          GatewayLease.FENCE.toMillis()
      ) {
        LOG.error(
          "No lease refresh for {} ms — stepping down before the TTL",
          GatewayLease.FENCE.toMillis()
        );
        stepDown();
      }
    }
  }

  private boolean claim(long now) {
    Long claimed = redis.execute(
      CLAIM,
      List.of(
        GatewayLease.holdersKey(GatewayLease.IMPLEMENTATION),
        GatewayLease.holdersKey(GatewayLease.OTHER)
      ),
      String.valueOf(now),
      String.valueOf(now + GatewayLease.TTL.toMillis()),
      podId,
      String.valueOf(GatewayLease.TTL.toMillis())
    );

    return Long.valueOf(1L).equals(claimed);
  }

  private boolean extend(long now) {
    Long extended = redis.execute(
      EXTEND,
      List.of(GatewayLease.holdersKey(GatewayLease.IMPLEMENTATION)),
      String.valueOf(now + GatewayLease.TTL.toMillis()),
      podId,
      String.valueOf(GatewayLease.TTL.toMillis())
    );

    return Long.valueOf(1L).equals(extended);
  }

  private void becomeActive() {
    lastRefreshAt = System.currentTimeMillis();
    runtime.activate();
    active.set(true);
    LOG.info(
      "Holding the gateway lease as {} ({})",
      GatewayLease.IMPLEMENTATION,
      podId
    );
  }

  /**
   * Stops serving, in the order that cannot overlap: not ready first, then
   * consuming, then the entry — released AFTER this process has stopped,
   * rather than before.
   */
  private void stepDown() {
    active.set(false);

    try {
      runtime.deactivate();
    } finally {
      release();
    }

    LOG.warn("Standing by — another implementation may take over");
  }

  private void release() {
    try {
      redis
        .opsForZSet()
        .remove(GatewayLease.holdersKey(GatewayLease.IMPLEMENTATION), podId);
    } catch (RuntimeException failure) {
      // The entry expires on its own within the TTL; a failure here delays a
      // handover, it does not break one.
      LOG.warn("Lease release failed: {}", failure.getMessage());
    }
  }

  /**
   * When the lease is released on shutdown: after the web server has stopped
   * serving (its graceful drain and stop are phases {@code DEFAULT_PHASE - 1024}
   * and {@code - 2048}), and BEFORE the Redis connection factory stops (phase 0).
   *
   * <p>Spring stops every lifecycle bean, highest phase first, before it destroys
   * any bean. A release in {@code @PreDestroy} therefore met a stopped Lettuce
   * factory, failed, and left the entry to its 30 s TTL. Measured in the cutover
   * rehearsal: the old side's entry outlived its pods by ~28 s, and that was most
   * of the handover window.
   */
  static final int PHASE = SmartLifecycle.DEFAULT_PHASE - 4096;

  @Override
  public int getPhase() {
    return PHASE;
  }

  @Override
  public boolean isRunning() {
    return started.get() && !stopping.get();
  }

  /** Releases the lease on shutdown, so the other side may claim at once. */
  @Override
  public void stop() {
    onShutdown();
  }

  /** Idempotent: the lifecycle stop and a direct call may both reach it. */
  public void onShutdown() {
    if (stopping.getAndSet(true)) return;
    beats.shutdownNow();

    if (active.get()) {
      stepDown();
    }
  }

  private static String host() {
    String fromKubernetes = System.getenv("POD_NAME");
    if (fromKubernetes != null && !fromKubernetes.isBlank()) {
      return fromKubernetes;
    }

    try {
      return InetAddress.getLocalHost().getHostName();
    } catch (UnknownHostException unknown) {
      return "unknown-host";
    }
  }

  private static String shortId() {
    return UUID.randomUUID().toString().substring(0, 8);
  }
}
