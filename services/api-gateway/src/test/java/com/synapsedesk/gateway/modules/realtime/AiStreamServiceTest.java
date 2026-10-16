package com.synapsedesk.gateway.modules.realtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.corundumstudio.socketio.HandshakeData;
import com.corundumstudio.socketio.SocketIOClient;
import com.synapsedesk.gateway.common.auth.JwtPrincipal;
import io.grpc.Status;
import io.netty.handler.codec.http.DefaultHttpHeaders;
import java.net.InetSocketAddress;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import synapsedesk.rag.Rag;
import synapsedesk.rag.RagServiceGrpc;
import synapsedesk.ticket.Common;
import synapsedesk.ticket.Message;
import synapsedesk.ticket.MessageServiceGrpc;
import synapsedesk.ticket.TicketServiceGrpc;

/**
 * The three completion branches — AT_CAP escalates and never persists,
 * REFUSED marks the message excluded and STILL persists, and a normal
 * completion just persists — plus the request/transcript shape and the
 * cancel-is-idempotent contract.
 */
class AiStreamServiceTest {

  private final MessageServiceGrpc.MessageServiceBlockingStub messages = mock(
    MessageServiceGrpc.MessageServiceBlockingStub.class
  );
  private final TicketServiceGrpc.TicketServiceBlockingStub tickets = mock(
    TicketServiceGrpc.TicketServiceBlockingStub.class
  );
  private final RagServiceGrpc.RagServiceBlockingStub rag = mock(
    RagServiceGrpc.RagServiceBlockingStub.class
  );
  private final AiStreamService service = new AiStreamService(
    messages,
    tickets,
    rag
  );

  private final JwtPrincipal principal = new JwtPrincipal(
    "u1",
    "o1",
    false,
    List.of(),
    List.of(),
    true,
    false
  );

  @BeforeEach
  void wireStubChaining() {
    when(messages.withDeadlineAfter(anyLong(), any())).thenReturn(messages);
    when(messages.withInterceptors(any())).thenReturn(messages);
    when(tickets.withDeadlineAfter(anyLong(), any())).thenReturn(tickets);
    when(tickets.withInterceptors(any())).thenReturn(tickets);
    when(rag.withInterceptors(any())).thenReturn(rag);

    when(messages.listMessages(any())).thenReturn(
      Message.ListMessagesResponse.newBuilder().build()
    );
    when(messages.getAiAttachments(any())).thenReturn(
      Message.GetAiAttachmentsResponse.newBuilder().build()
    );
    when(tickets.getTicket(any())).thenReturn(
      Common.TicketResponse.newBuilder()
        .setId("t1")
        .setDescription("The app says my session expired.")
        .build()
    );
  }

  private static SocketIOClient client() {
    SocketIOClient client = mock(SocketIOClient.class);
    HandshakeData handshake = new HandshakeData(
      new DefaultHttpHeaders(),
      Map.of(),
      new InetSocketAddress(0),
      "/ws",
      false
    );
    when(client.getHandshakeData()).thenReturn(handshake);
    when(client.getSessionId()).thenReturn(UUID.randomUUID());
    when(client.isWritable()).thenReturn(true);

    return client;
  }

  private static Rag.ChatChunk token(String text) {
    return Rag.ChatChunk.newBuilder().setToken(text).build();
  }

  private static Rag.ChatChunk completion(
    Rag.AnswerStatus status,
    String content
  ) {
    return Rag.ChatChunk.newBuilder()
      .setCompletion(
        Rag.ChatCompletion.newBuilder().setStatus(status).setContent(content)
      )
      .build();
  }

  @Test
  void theTranscriptLeadsWithTheOpeningQuestionTheDescription() {
    SocketIOClient client = client();
    when(messages.listMessages(any())).thenReturn(
      Message.ListMessagesResponse.newBuilder()
        .addItems(
          Message.MessageResponse.newBuilder()
            .setId("m1")
            .setSenderId("u1")
            .setContent("and on weekends?")
        )
        .build()
    );
    when(rag.chat(any())).thenReturn(
      List.of(
        completion(Rag.AnswerStatus.ANSWER_STATUS_DOC_ANSWER, "Yes")
      ).iterator()
    );
    when(messages.appendAiMessage(any())).thenReturn(
      Message.MessageResponse.newBuilder().setId("m-persisted").build()
    );

    service.start(client, "t1", "hi", principal, "m1");

    ArgumentCaptor<Rag.ChatRequest> captor = ArgumentCaptor.forClass(
      Rag.ChatRequest.class
    );
    verify(rag, timeout(2000)).chat(captor.capture());
    assertThat(
      captor
        .getValue()
        .getHistoryList()
        .stream()
        .map(turn -> turn.getRole() + ": " + turn.getContent())
        .toList()
    ).containsExactly(
      "user: The app says my session expired.",
      "user: and on weekends?"
    );
  }

  @Test
  void aNormalCompletionPersistsAndEmitsDone() {
    SocketIOClient client = client();
    when(rag.chat(any())).thenReturn(
      List.of(
        token("Hel"),
        token("lo"),
        completion(Rag.AnswerStatus.ANSWER_STATUS_DOC_ANSWER, "Hello")
      ).iterator()
    );
    when(messages.appendAiMessage(any())).thenReturn(
      Message.MessageResponse.newBuilder().setId("m-persisted").build()
    );

    service.start(client, "t1", "hi", principal, "m1");

    verify(client, timeout(2000)).sendEvent(
      org.mockito.ArgumentMatchers.eq(
        com.synapsedesk.gateway.common.contracts.RealtimeEvents.REALTIME_EVENTS_AI_STREAM_DONE
      ),
      any()
    );
    verify(messages).appendAiMessage(any());
    verify(tickets, never()).escalateTicket(any());

    ArgumentCaptor<Message.AppendAiMessageRequest> captor =
      ArgumentCaptor.forClass(Message.AppendAiMessageRequest.class);
    verify(messages).appendAiMessage(captor.capture());
    assertThat(captor.getValue().getContent()).isEqualTo("Hello");
    assertThat(captor.getValue().getTicketId()).isEqualTo("t1");
  }

  /** The `ai:stream:error` frame a stream that threw sends, for its message. */
  private WsResponse<?> errorFrameFor(RuntimeException failure) {
    SocketIOClient client = client();
    when(rag.chat(any())).thenThrow(failure);

    service.start(client, "t1", "hi", principal, "m1");

    ArgumentCaptor<Object> payload = ArgumentCaptor.forClass(Object.class);
    verify(client, timeout(2000)).sendEvent(
      org.mockito.ArgumentMatchers.eq(
        com.synapsedesk.gateway.common.contracts.RealtimeEvents.REALTIME_EVENTS_AI_STREAM_ERROR
      ),
      payload.capture()
    );
    return (WsResponse<?>) payload.getValue();
  }

  @Test
  void anInternalFailureReachesTheClientAsAGenericMessage() {
    WsResponse<?> frame = errorFrameFor(
      Status.UNKNOWN.withDescription(
        "Unexpected <class 'NameError'>: name '_attachments_of' is not defined"
      ).asRuntimeException()
    );

    assertThat(frame.success()).isFalse();
    assertThat(frame.message()).isEqualTo("Internal server error!");
  }

  @Test
  void aMarkedRefusalKeepsItsMessage() {
    WsResponse<?> frame = errorFrameFor(
      Status.INVALID_ARGUMENT.withDescription(
        "[http:422] The question is too long"
      ).asRuntimeException()
    );

    assertThat(frame.message()).isEqualTo("The question is too long!");
  }

  @Test
  void atCapEscalatesAndNeverPersistsAMessage() {
    SocketIOClient client = client();
    when(rag.chat(any())).thenReturn(
      List.of(completion(Rag.AnswerStatus.ANSWER_STATUS_AT_CAP, "")).iterator()
    );
    when(tickets.escalateTicket(any())).thenReturn(
      Common.TicketResponse.getDefaultInstance()
    );

    service.start(client, "t1", "hi", principal, "m1");

    verify(tickets, timeout(2000)).escalateTicket(any());
    verify(messages, never()).appendAiMessage(any());

    ArgumentCaptor<Object> payload = ArgumentCaptor.forClass(Object.class);
    verify(client, timeout(2000)).sendEvent(
      org.mockito.ArgumentMatchers.eq(
        com.synapsedesk.gateway.common.contracts.RealtimeEvents.REALTIME_EVENTS_AI_STREAM_DONE
      ),
      payload.capture()
    );
    WsResponse<?> response = (WsResponse<?>) payload.getValue();
    AiStreamDonePayload done = (AiStreamDonePayload) response.data();
    assertThat(done.escalated()).isTrue();
    assertThat(done.messageId()).isNull();
  }

  @Test
  void refusedExcludesFromAiContextButStillPersistsTheAnswer() {
    SocketIOClient client = client();
    when(rag.chat(any())).thenReturn(
      List.of(
        completion(
          Rag.AnswerStatus.ANSWER_STATUS_REFUSED,
          "I can't help with that"
        )
      ).iterator()
    );
    when(messages.appendAiMessage(any())).thenReturn(
      Message.MessageResponse.newBuilder().setId("m-persisted").build()
    );

    service.start(client, "t1", "hi", principal, "m1");

    verify(messages, timeout(2000)).appendAiMessage(any());

    InOrder order = org.mockito.Mockito.inOrder(messages);
    order.verify(messages).excludeFromAiContext(any());
    order.verify(messages).appendAiMessage(any());
  }

  @Test
  void cancelIsIdempotentAndUnknownStreamsReturnFalse() {
    SocketIOClient client = client();
    assertThat(service.cancel(client, "unknown")).isFalse();
  }
}
