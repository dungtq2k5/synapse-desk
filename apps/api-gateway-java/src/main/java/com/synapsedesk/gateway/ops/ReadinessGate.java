package com.synapsedesk.gateway.ops;

import com.synapsedesk.gateway.generated.model.ReadinessDependenciesResponseDto;

/**
 * One reason this instance may not be ready, and how it appears under
 * `dependencies`.
 *
 * <p>An interface so that readiness stays a LIST of local conditions rather
 * than a growing method: Redis reachability and the implementation lease each
 * arrive in their own step and each contributes one of these.
 *
 * <p><b>A peer is never a gate.</b> Every instance sees the same peer down, so
 * gating on one would remove all of them and turn one service's outage into a
 * total one — ADR 0010. Peers are REPORTED and do not decide.
 *
 * <p>{@link #report} takes the GENERATED dependencies object rather than a
 * map, because the field set is part of the shared document: a gate that
 * wanted a new key would have to add it there first, where the Node gateway
 * would publish it too.
 */
public interface ReadinessGate {

  /** True when this condition is satisfied. */
  boolean isReady();

  /** Writes this gate's state onto the response's `dependencies`. */
  void report(ReadinessDependenciesResponseDto dependencies, boolean ready);
}
