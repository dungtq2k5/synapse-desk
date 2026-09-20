package com.synapsedesk.gateway.ops;

import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.boot.availability.AvailabilityChangeEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * Whether this instance is shutting down.
 *
 * <p>Readiness goes red BEFORE the listener closes, so the Service removes
 * this pod's endpoint while in-flight requests finish. There is deliberately
 * no {@code preStop} sleep in the manifest: a sleep delays SIGTERM and hopes
 * the endpoint update wins the race, where saying "not ready" states it.
 */
@Component
public class DrainState {

  private final AtomicBoolean draining = new AtomicBoolean();

  /** True from the moment shutdown begins. */
  public boolean isDraining() {
    return draining.get();
  }

  /**
   * Boot publishes this when the context starts closing, which is earlier than
   * a {@code @PreDestroy} on an arbitrary bean and does not depend on bean
   * destruction order.
   */
  @EventListener
  public void onAvailabilityChange(AvailabilityChangeEvent<?> event) {
    if (event.getState()
        == org.springframework.boot.availability.ReadinessState.REFUSING_TRAFFIC) {
      draining.set(true);
    }
  }

  /** For the shutdown hook and for tests that need the drained state. */
  public void startDraining() {
    draining.set(true);
  }

  /** Undoes {@link #startDraining()}. Only a test has any business calling it. */
  public void reset() {
    draining.set(false);
  }
}
