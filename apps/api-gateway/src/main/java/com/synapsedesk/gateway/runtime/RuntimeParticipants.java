package com.synapsedesk.gateway.runtime;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.SmartLifecycle;
import org.springframework.stereotype.Component;

/**
 * Starts every {@link RuntimeParticipant} at boot and stops them on shutdown.
 *
 * <p><b>A participant that cannot start does not stop the gateway.</b> Each is
 * started on its own, in {@code @Order}, once synchronously at boot (so with NATS
 * and Redis up, every consumer is subscribed before the HTTP port opens) and then
 * every {@link #RETRY} until it succeeds. A NATS or Redis outage at boot therefore
 * leaves the HTTP routes serving, and the consumers and sockets arrive when the
 * broker does. Readiness does not wait for them: NATS and Redis are shared by every
 * replica, and gating on them would take all of them out at once (ADR 0010).
 *
 * <p><b>Stop in reverse.</b> Whichever participant started last has the least
 * depending on it, so stopping in reverse means "stop consuming, then drop
 * sockets": a relay never fires into a room whose sockets are mid-teardown.
 *
 * <p>Phase {@link #PHASE}: stopped after the web server has stopped serving (its
 * drain and stop are {@code DEFAULT_PHASE - 1024} and {@code - 2048}) and before
 * the Redis connection factory (phase 0).
 */
@Component
public class RuntimeParticipants implements SmartLifecycle {

  private static final Logger LOG = LoggerFactory.getLogger(
    RuntimeParticipants.class
  );

  static final Duration RETRY = Duration.ofSeconds(2);

  static final int PHASE = SmartLifecycle.DEFAULT_PHASE - 4096;

  private final List<RuntimeParticipant> participants;

  /** The participants started so far, in the order they started. */
  private final List<RuntimeParticipant> active = new ArrayList<>();

  private ScheduledExecutorService retries;

  public RuntimeParticipants(List<RuntimeParticipant> participants) {
    this.participants = participants;
  }

  /**
   * Starts each participant not yet active; true when all are. Package-private
   * so a test drives the retry without a clock.
   */
  synchronized boolean startPending() {
    for (RuntimeParticipant participant : participants) {
      if (active.contains(participant)) continue;
      try {
        participant.activate();
        active.add(participant);
      } catch (RuntimeException failure) {
        LOG.warn(
          "{} did not start, retrying in {} s: {}",
          participant.getClass().getSimpleName(),
          RETRY.toSeconds(),
          failure.getMessage()
        );
      }
    }

    return active.size() == participants.size();
  }

  @Override
  public synchronized void start() {
    if (retries != null) return;
    ScheduledExecutorService executor =
      Executors.newSingleThreadScheduledExecutor(task -> {
        Thread thread = new Thread(task, "runtime-participants");
        thread.setDaemon(true);
        return thread;
      });
    retries = executor;
    if (startPending()) return;

    executor.scheduleWithFixedDelay(
      () -> retry(executor),
      RETRY.toMillis(),
      RETRY.toMillis(),
      TimeUnit.MILLISECONDS
    );
  }

  /** One retry, unless {@link #stop} has run since {@code executor} was scheduled. */
  private synchronized void retry(ScheduledExecutorService executor) {
    if (retries != executor) return;
    if (startPending()) executor.shutdown();
  }

  @Override
  public synchronized void stop() {
    if (retries == null) return;
    retries.shutdownNow();
    retries = null;
    for (int i = active.size() - 1; i >= 0; i--) {
      try {
        active.get(i).deactivate();
      } catch (RuntimeException failure) {
        LOG.warn(
          "{} did not stop cleanly: {}",
          active.get(i).getClass().getSimpleName(),
          failure.getMessage()
        );
      }
    }
    active.clear();
  }

  @Override
  public synchronized boolean isRunning() {
    return retries != null;
  }

  @Override
  public int getPhase() {
    return PHASE;
  }
}
