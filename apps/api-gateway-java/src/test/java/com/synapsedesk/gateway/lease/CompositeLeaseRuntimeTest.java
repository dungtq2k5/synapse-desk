package com.synapsedesk.gateway.lease;

import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;

/**
 * {@code CompositeLeaseRuntime}'s one safety-critical property: activation
 * runs in list order, deactivation in the EXACT reverse — never just "both
 * ran". A participant list ordered by an ignored {@code @Order} (on a
 * {@code @Bean} method rather than the class — see {@link
 * LeaseParticipant}'s own docblock) would still pass a test that only
 * checked each method was called once; this one asserts the sequence.
 */
class CompositeLeaseRuntimeTest {

  @Test
  void activatesInListOrderAndDeactivatesInReverse() {
    LeaseParticipant first = mock(LeaseParticipant.class);
    LeaseParticipant second = mock(LeaseParticipant.class);
    LeaseParticipant third = mock(LeaseParticipant.class);
    CompositeLeaseRuntime composite = new CompositeLeaseRuntime(
      List.of(first, second, third)
    );

    composite.activate();

    InOrder activationOrder = inOrder(first, second, third);
    activationOrder.verify(first).activate();
    activationOrder.verify(second).activate();
    activationOrder.verify(third).activate();

    composite.deactivate();

    InOrder deactivationOrder = inOrder(third, second, first);
    deactivationOrder.verify(third).deactivate();
    deactivationOrder.verify(second).deactivate();
    deactivationOrder.verify(first).deactivate();
  }

  @Test
  void anEmptyParticipantListActivatesAndDeactivatesWithoutError() {
    new CompositeLeaseRuntime(List.of()).activate();
    new CompositeLeaseRuntime(List.of()).deactivate();
  }
}
