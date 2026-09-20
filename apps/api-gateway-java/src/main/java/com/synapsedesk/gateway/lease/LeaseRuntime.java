package com.synapsedesk.gateway.lease;

/**
 * What the process starts when it becomes active, and stops when it steps
 * down.
 *
 * <p>An interface because what it controls belongs to the composition root,
 * not to the lease: the NATS consumer and the socket server are started by
 * the application and merely SEQUENCED by the lease. The skeleton has
 * neither yet, so the default implementation does nothing — and says so,
 * rather than leaving a reader to wonder whether a standby is really inert.
 */
public interface LeaseRuntime {

  /** Start consuming. Called once, when the lease is claimed. */
  void activate();

  /** Stop consuming and drop sockets, in that order. */
  void deactivate();
}
