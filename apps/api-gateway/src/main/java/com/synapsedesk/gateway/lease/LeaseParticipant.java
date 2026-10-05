package com.synapsedesk.gateway.lease;

/**
 * One thing the process starts when it becomes active and stops when it
 * steps down — a member of {@link CompositeLeaseRuntime}, not the
 * {@link LeaseRuntime} bean {@link GatewayLeaseService} itself depends on.
 *
 * <p>A separate interface from {@code LeaseRuntime}, deliberately: {@code
 * GatewayLeaseService}'s constructor takes exactly ONE {@code LeaseRuntime},
 * so a second {@code @Component implements LeaseRuntime} fails to wire the
 * moment it exists (two candidates, one constructor parameter). Every
 * feature that needs lease-driven start/stop implements this instead, and
 * {@link CompositeLeaseRuntime} is the one {@code LeaseRuntime} that
 * sequences all of them.
 *
 * <p><b>Order matters for teardown, and Spring will not infer it.</b>
 * {@code @Order} on a {@code @Bean} FACTORY METHOD is ignored — the bean it
 * produces lands at the lowest precedence regardless of the value given.
 * {@code @Order} on the {@code @Component} CLASS itself is what {@link
 * CompositeLeaseRuntime}'s {@code List<LeaseParticipant>} injection actually
 * honours. Every implementer must carry it there, on the class.
 */
public interface LeaseParticipant {
  /**
   * Start. Called once, when the lease is claimed.
   *
   * <p><b>Returning means ACTIVE, not "started".</b> A participant that consumes
   * from a broker must not return until the broker has registered what it asked
   * for: a subscription that is only queued on the connection leaves a window in
   * which this process believes it is consuming and events published to the bus
   * are dropped, with no retry and no log. Core NATS drops what nobody is
   * subscribed to yet, so flush before returning.
   */
  void activate();

  /** Stop. Called once, when the lease is lost. */
  void deactivate();
}
