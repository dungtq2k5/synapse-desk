package com.synapsedesk.gateway.common.runtime;

/**
 * Something the gateway runs beside its HTTP routes, started and stopped by
 * {@link RuntimeParticipants}: a NATS consumer, the socket server.
 *
 * <p><b>Order matters for teardown, and Spring will not infer it.</b>
 * {@code @Order} on a {@code @Bean} FACTORY METHOD is ignored — the bean it
 * produces lands at the lowest precedence regardless of the value given.
 * {@code @Order} on the {@code @Component} CLASS itself is what
 * {@link RuntimeParticipants}'s {@code List<RuntimeParticipant>} injection
 * honours. Every implementer must carry it there, on the class.
 */
public interface RuntimeParticipant {
  /**
   * Start. Throwing means "not yet": {@link RuntimeParticipants} tries again.
   *
   * <p><b>Returning means ACTIVE, not "started".</b> A participant that consumes
   * from a broker must not return until the broker has registered what it asked
   * for: a subscription that is only queued on the connection leaves a window in
   * which this process believes it is consuming and events published to the bus
   * are dropped, with no retry and no log. Core NATS drops what nobody is
   * subscribed to yet, so flush before returning.
   */
  void activate();

  /** Stop. Called once, on shutdown, and only after a successful {@link #activate}. */
  void deactivate();
}
