package com.synapsedesk.gateway.runtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;

/**
 * Starting in order and stopping in the EXACT reverse, and a participant that
 * cannot start yet neither stopping the others nor being started twice.
 */
class RuntimeParticipantsTest {

  @Test
  void startsInListOrderAndStopsInReverse() {
    RuntimeParticipant first = mock(RuntimeParticipant.class);
    RuntimeParticipant second = mock(RuntimeParticipant.class);
    RuntimeParticipant third = mock(RuntimeParticipant.class);
    RuntimeParticipants participants = new RuntimeParticipants(
      List.of(first, second, third)
    );

    participants.start();
    participants.stop();

    InOrder order = inOrder(first, second, third);
    order.verify(first).activate();
    order.verify(second).activate();
    order.verify(third).activate();
    order.verify(third).deactivate();
    order.verify(second).deactivate();
    order.verify(first).deactivate();
  }

  @Test
  void aParticipantThatCannotStartIsRetriedAloneAndTheOthersRun() {
    RuntimeParticipant realtime = mock(RuntimeParticipant.class);
    RuntimeParticipant consumer = mock(RuntimeParticipant.class);
    doThrow(new IllegalStateException("redis is down"))
      .doNothing()
      .when(realtime)
      .activate();
    RuntimeParticipants participants = new RuntimeParticipants(
      List.of(realtime, consumer)
    );

    assertThat(participants.startPending()).isFalse();
    verify(consumer).activate();

    assertThat(participants.startPending()).isTrue();
    verify(realtime, times(2)).activate();
    // Already active: never started a second time, so no second connection.
    verify(consumer, times(1)).activate();
  }

  @Test
  void onlyWhatStartedIsStopped() {
    RuntimeParticipant started = mock(RuntimeParticipant.class);
    RuntimeParticipant neverStarted = mock(RuntimeParticipant.class);
    doNothing().when(started).activate();
    doThrow(new IllegalStateException("nats is down"))
      .when(neverStarted)
      .activate();
    RuntimeParticipants participants = new RuntimeParticipants(
      List.of(started, neverStarted)
    );

    participants.start();
    participants.stop();

    verify(started).deactivate();
    verify(neverStarted, never()).deactivate();
  }

  @Test
  void anEmptyListIsANoOp() {
    RuntimeParticipants participants = new RuntimeParticipants(List.of());

    participants.start();
    participants.stop();
  }
}
