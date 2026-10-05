package com.synapsedesk.gateway.lease;

import java.util.List;
import org.springframework.stereotype.Component;

/**
 * The one real {@link LeaseRuntime} — sequences every {@link
 * LeaseParticipant} Spring finds, replacing {@link InertRuntime}'s
 * {@code @ConditionalOnMissingBean} no-op the moment a first participant
 * exists.
 *
 * <p><b>Activate forward, deactivate in reverse.</b> A single {@code @Order}
 * ranking on each participant's class is enough to express both directions
 * correctly with no separate "teardown order" to keep in sync by hand:
 * whichever participant activates LAST is the one with the least set up to
 * lose, so tearing down in reverse means the participant that has been
 * running longest — with the most depending on it — is stopped last.
 *
 * <p>This is exactly Node's own realtime deactivation contract, generalized:
 * {@code GatewayLeaseService}'s Node callback stops the NATS consumer, THEN
 * drops sockets — one participant's own two-phase teardown. Where this
 * gateway has MULTIPLE participants (cache invalidation today; realtime
 * next), the same "later-activated, earlier-deactivated" rule is what keeps
 * a relay-owning participant from trying to emit to sockets a
 * later-in-the-list participant is mid-way through dropping.
 */
@Component
public class CompositeLeaseRuntime implements LeaseRuntime {

  private final List<LeaseParticipant> participants;

  public CompositeLeaseRuntime(List<LeaseParticipant> participants) {
    this.participants = participants;
  }

  @Override
  public void activate() {
    for (LeaseParticipant participant : participants) {
      participant.activate();
    }
  }

  @Override
  public void deactivate() {
    for (int i = participants.size() - 1; i >= 0; i--) {
      participants.get(i).deactivate();
    }
  }
}
