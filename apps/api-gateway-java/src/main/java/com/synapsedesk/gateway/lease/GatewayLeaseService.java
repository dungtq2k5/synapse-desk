package com.synapsedesk.gateway.lease;

import com.synapsedesk.gateway.ops.ReadinessGate;
import com.synapsedesk.gateway.generated.model.ReadinessDependenciesResponseDto;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

/**
 * One implementation serves at a time; the other waits warm.
 *
 * <p><b>A standby, not a refusal.</b> A refusal would put the JVM's whole
 * startup inside a switch window. A standby boots, warms, answers `/health` so
 * the kubelet leaves it alone, and answers `/health/ready` with 503 so the
 * Service sends it nothing — while consuming no NATS subject and accepting no
 * socket. The window then costs only the old pods draining plus one poll.
 *
 * <p><b>Per pod, not per implementation.</b> With `replicas: 2` a single
 * shared key would be deleted by the first pod to exit, handing over while the
 * second is still consuming. Each pod holds its own entry, and a standby may
 * become active only when no unexpired entry of the OTHER implementation
 * remains — so replicas of one implementation join each other and the two
 * implementations still exclude.
 *
 * <p>This is the Node `GatewayLeaseService` with the sides swapped, and that
 * is the point: the exclusion only works if both run the same script against
 * the same keys. {@link GatewayLease} holds the shared half.
 */
@Component
public class GatewayLeaseService implements ReadinessGate {

  private static final Logger LOG = LoggerFactory.getLogger(GatewayLeaseService.class);

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

  private final java.util.concurrent.ScheduledExecutorService beats =
      java.util.concurrent.Executors.newSingleThreadScheduledExecutor(
          runnable -> {
            Thread thread = new Thread(runnable, "gateway-lease");
            thread.setDaemon(true);

            return thread;
          });
  private volatile long lastRefreshAt;

  public GatewayLeaseService(StringRedisTemplate redis, LeaseRuntime runtime) {
    this.redis = redis;
    this.runtime = runtime;
    this.podId = "%s:%d:%s".formatted(host(), ProcessHandle.current().pid(), shortId());
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
  public void report(ReadinessDependenciesResponseDto dependencies, boolean ready) {
    // The lease does not appear under `dependencies` — that object's fields
    // come from the shared document, and adding one would mean publishing it
    // on the Node side too. `ready` already says whether to route here, which
    // is the field a Service reads.
  }

  /**
   * Starts beating, immediately and then every {@link GatewayLease#REFRESH}.
   *
   * <p><b>Its own scheduler, not `@Scheduled`.</b> Measured: a
   * `fixedRateString` of `#{@gatewayLeaseService.refreshMillis}` makes the
   * bean depend on itself and Spring refuses the context with a cycle. A
   * literal interval would put the timing contract in two places, and the
   * interval is shared with the Node side — so the interval stays in
   * {@link GatewayLease} and the schedule is built from it here.
   *
   * <p>The thread is a DAEMON: a gateway whose only remaining work is this
   * timer should exit, which is what `unref()` buys on the Node side.
   */
  @jakarta.annotation.PostConstruct
  public void start() {
    beats.scheduleAtFixedRate(
        this::beat, 0, GatewayLease.REFRESH.toMillis(), java.util.concurrent.TimeUnit.MILLISECONDS);
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

      if (active.get()
          && System.currentTimeMillis() - lastRefreshAt > GatewayLease.FENCE.toMillis()) {
        LOG.error(
            "No lease refresh for {} ms — stepping down before the TTL",
            GatewayLease.FENCE.toMillis());
        stepDown();
      }
    }
  }

  private boolean claim(long now) {
    Long claimed =
        redis.execute(
            CLAIM,
            List.of(
                GatewayLease.holdersKey(GatewayLease.IMPLEMENTATION),
                GatewayLease.holdersKey(GatewayLease.OTHER)),
            String.valueOf(now),
            String.valueOf(now + GatewayLease.TTL.toMillis()),
            podId,
            String.valueOf(GatewayLease.TTL.toMillis()));

    return Long.valueOf(1L).equals(claimed);
  }

  private boolean extend(long now) {
    Long extended =
        redis.execute(
            EXTEND,
            List.of(GatewayLease.holdersKey(GatewayLease.IMPLEMENTATION)),
            String.valueOf(now + GatewayLease.TTL.toMillis()),
            podId,
            String.valueOf(GatewayLease.TTL.toMillis()));

    return Long.valueOf(1L).equals(extended);
  }

  private void becomeActive() {
    lastRefreshAt = System.currentTimeMillis();
    runtime.activate();
    active.set(true);
    LOG.info("Holding the gateway lease as {} ({})", GatewayLease.IMPLEMENTATION, podId);
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
      redis.opsForZSet().remove(GatewayLease.holdersKey(GatewayLease.IMPLEMENTATION), podId);
    } catch (RuntimeException failure) {
      // The entry expires on its own within the TTL; a failure here delays a
      // handover, it does not break one.
      LOG.warn("Lease release failed: {}", failure.getMessage());
    }
  }

  /** Releases the lease on shutdown, so the other side may claim at once. */
  @jakarta.annotation.PreDestroy
  public void onShutdown() {
    stopping.set(true);
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
