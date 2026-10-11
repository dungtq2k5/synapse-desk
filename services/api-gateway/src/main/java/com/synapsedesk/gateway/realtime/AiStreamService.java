package com.synapsedesk.gateway.realtime;

import com.corundumstudio.socketio.SocketIOClient;
import com.synapsedesk.gateway.common.auth.JwtPrincipal;
import com.synapsedesk.gateway.common.contracts.RealtimeEvents;
import com.synapsedesk.gateway.common.error.GrpcStatusMapping;
import com.synapsedesk.gateway.common.grpc.CallerMetadata;
import io.grpc.Context;
import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import io.grpc.stub.MetadataUtils;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CancellationException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import org.springframework.stereotype.Component;
import synapsedesk.auth.Common.PageRequest;
import synapsedesk.auth.Common.SortOrder;
import synapsedesk.rag.Rag;
import synapsedesk.rag.Rag.AnswerStatus;
import synapsedesk.rag.Rag.ChatChunk;
import synapsedesk.rag.Rag.ChatCompletion;
import synapsedesk.rag.RagServiceGrpc;
import synapsedesk.ticket.Message.AppendAiMessageRequest;
import synapsedesk.ticket.Message.ExcludeFromAiContextRequest;
import synapsedesk.ticket.Message.GetAiAttachmentsRequest;
import synapsedesk.ticket.Message.GetAiAttachmentsResponse;
import synapsedesk.ticket.Message.ListMessagesRequest;
import synapsedesk.ticket.Message.ListMessagesResponse;
import synapsedesk.ticket.Message.MessageAnswerStatus;
import synapsedesk.ticket.Message.MessageCitations;
import synapsedesk.ticket.Message.MessageResponse;
import synapsedesk.ticket.MessageServiceGrpc;
import synapsedesk.ticket.Ticket.TicketStatusActionRequest;
import synapsedesk.ticket.TicketServiceGrpc;

/**
 * A token-by-token rag-service `Chat` stream relayed to one socket, never a
 * room.
 *
 * <p><b>Cancellation.</b> A blocking stub's server-streaming call returns a
 * plain {@code Iterator}, with no cancel hook — cancellation here is a {@code
 * Context.CancellableContext} attached on the WORKER thread before the call,
 * cancelled from any other thread; the blocked {@code hasNext()}/{@code
 * next()} then throws a {@code CANCELLED StatusRuntimeException}, which this
 * class treats as the intentional-stop path, never a failure to report.
 *
 * <p><b>Backpressure is measured in bytes, because that is what
 * netty-socketio actually exposes.</b> netty-socketio/Netty expose no frame
 * count — {@link SocketIOClient#isWritable()} is backed by Netty's own BYTE
 * high/low watermark on the channel, and answers "is this client falling
 * behind on writes".
 */
@Component
public class AiStreamService {

  private static final int TRANSCRIPT_TURNS = 40;
  private static final long UNARY_DEADLINE_SECONDS = 5;
  private static final String AT_CAP_REASON =
    "Escalated automatically: the workspace is at its AI budget cap";

  private final MessageServiceGrpc.MessageServiceBlockingStub messages;
  private final TicketServiceGrpc.TicketServiceBlockingStub tickets;
  private final RagServiceGrpc.RagServiceBlockingStub rag;

  /**
   * Per-socket — a disconnect drops the
   * whole entry ({@link #cancelAll}), so nothing outlives the connection
   * that started it.
   */
  private final Map<UUID, Map<String, LiveStream>> streamsBySession =
    new ConcurrentHashMap<>();

  private record LiveStream(
    String ticketId,
    Context.CancellableContext context
  ) {}

  public AiStreamService(
    MessageServiceGrpc.MessageServiceBlockingStub messages,
    TicketServiceGrpc.TicketServiceBlockingStub tickets,
    RagServiceGrpc.RagServiceBlockingStub rag
  ) {
    this.messages = messages;
    this.tickets = tickets;
    this.rag = rag;
  }

  /**
   * Opens the stream and returns its id immediately — never waits for the
   * generation. {@code messageId} is the just-created human message this
   * answer is attached to; absent for `/knowledge/ask`-style callers this
   * gateway does not have yet, so attachments are fetched only when present.
   */
  public String start(
    SocketIOClient client,
    String ticketId,
    String question,
    JwtPrincipal principal,
    String messageId
  ) {
    String streamId = UUID.randomUUID().toString();
    List<Rag.ConversationTurn> history = transcript(
      ticketId,
      principal,
      client
    );
    AttachmentsResult attachments =
      messageId != null
        ? aiAttachments(messageId, principal, client)
        : new AttachmentsResult(List.of(), List.of());

    if (!attachments.skipped().isEmpty()) {
      notifySkipped(client, ticketId, attachments.skipped());
    }

    Rag.ChatRequest request = Rag.ChatRequest.newBuilder()
      .setMessage(question)
      .addAllHistory(history)
      .setTicketId(ticketId)
      .addAllAttachments(attachments.parts())
      .setAttachmentCount(
        attachments.parts().size() + attachments.skipped().size()
      )
      .build();

    Context.CancellableContext cancellable =
      Context.current().withCancellation();
    streamsBySession
      .computeIfAbsent(client.getSessionId(), ignored ->
        new ConcurrentHashMap<>()
      )
      .put(streamId, new LiveStream(ticketId, cancellable));

    Thread.ofVirtual().start(() ->
      runStream(
        client,
        streamId,
        ticketId,
        principal,
        messageId,
        request,
        cancellable
      )
    );

    return streamId;
  }

  /** {@code false} if the streamId is unknown or belongs to another socket — never an error. */
  public boolean cancel(SocketIOClient client, String streamId) {
    Map<String, LiveStream> forSocket = streamsBySession.get(
      client.getSessionId()
    );
    LiveStream stream = forSocket == null ? null : forSocket.remove(streamId);
    if (stream == null) {
      return false;
    }

    stream.context().cancel(new CancellationException("Stream cancelled"));

    return true;
  }

  public void cancelAll(SocketIOClient client) {
    Map<String, LiveStream> forSocket = streamsBySession.remove(
      client.getSessionId()
    );
    if (forSocket == null) {
      return;
    }

    for (LiveStream stream : forSocket.values()) {
      stream.context().cancel(new CancellationException("Socket disconnected"));
    }
  }

  private void runStream(
    SocketIOClient client,
    String streamId,
    String ticketId,
    JwtPrincipal principal,
    String messageId,
    Rag.ChatRequest request,
    Context.CancellableContext cancellable
  ) {
    Context previous = cancellable.attach();
    boolean completed = false;
    StringBuilder tokens = new StringBuilder();

    try {
      Iterator<ChatChunk> chunks = ragWith(principal, client).chat(request);

      while (chunks.hasNext()) {
        ChatChunk chunk = chunks.next();

        if (chunk.hasToken()) {
          tokens.append(chunk.getToken());
          if (!relayToken(client, streamId, ticketId, chunk.getToken())) {
            // Wedged — relayToken already cancelled, failed and forgot it.
            return;
          }
        } else if (chunk.hasCompletion()) {
          completed = true;
          settle(
            client,
            streamId,
            ticketId,
            principal,
            messageId,
            chunk.getCompletion(),
            tokens.toString()
          );
        }
      }

      if (!completed) {
        forget(client, streamId);
        fail(
          client,
          streamId,
          ticketId,
          "The answer stream ended unexpectedly"
        );
      }
    } catch (StatusRuntimeException grpcFailure) {
      if (grpcFailure.getStatus().getCode() == Status.Code.CANCELLED) {
        // Cancelled BY this class (wedge, `ai:stream:cancel`, or a
        // disconnect) — the entry is already gone, and cancelling is not a
        // failure to report.
        return;
      }

      forget(client, streamId);
      fail(client, streamId, ticketId, clientText(grpcFailure));
    } catch (RuntimeException failure) {
      forget(client, streamId);
      fail(client, streamId, ticketId, clientText(failure));
    } finally {
      cancellable.detach(previous);
    }
  }

  /** {@code false} means wedged — the caller must stop reading the stream. */
  private boolean relayToken(
    SocketIOClient client,
    String streamId,
    String ticketId,
    String token
  ) {
    if (!client.isWritable()) {
      cancel(client, streamId);
      fail(client, streamId, ticketId, "The stream fell too far behind");

      return false;
    }

    client.sendEvent(
      RealtimeEvents.REALTIME_EVENTS_AI_STREAM_CHUNK,
      WsResponse.ok(
        "Streaming",
        new AiStreamChunkPayload(streamId, ticketId, token)
      )
    );

    return true;
  }

  private void settle(
    SocketIOClient client,
    String streamId,
    String ticketId,
    JwtPrincipal principal,
    String messageId,
    ChatCompletion completion,
    String joinedTokens
  ) {
    forget(client, streamId);

    try {
      String content = !completion.getContent().isEmpty()
        ? completion.getContent()
        : joinedTokens;

      if (completion.getStatus() == AnswerStatus.ANSWER_STATUS_AT_CAP) {
        ticketsWith(principal, client).escalateTicket(
          TicketStatusActionRequest.newBuilder()
            .setTicketId(ticketId)
            .setReason(AT_CAP_REASON)
            .build()
        );
        done(
          client,
          new AiStreamDonePayload(
            streamId,
            ticketId,
            null,
            "",
            List.of(),
            true,
            frameAnswerStatus(AnswerStatus.ANSWER_STATUS_AT_CAP)
          )
        );

        return;
      }

      if (
        completion.getStatus() == AnswerStatus.ANSWER_STATUS_REFUSED &&
        messageId != null
      ) {
        messagesWith(principal, client).excludeFromAiContext(
          ExcludeFromAiContextRequest.newBuilder()
            .setTicketId(ticketId)
            .setMessageId(messageId)
            .build()
        );
      }

      List<Rag.Citation> citations = completion.getCitationsList();
      AppendAiMessageRequest.Builder append =
        AppendAiMessageRequest.newBuilder()
          .setTicketId(ticketId)
          .setContent(content)
          .setAnswerStatus(toMessageAnswerStatus(completion.getStatus()))
          .setCitations(
            MessageCitations.newBuilder().addAllItems(
              citations.stream().map(this::toDraftCitation).toList()
            )
          );
      if (!completion.getGenerationId().isEmpty()) {
        append.setGenerationId(completion.getGenerationId());
      }

      MessageResponse persisted = messagesWith(
        principal,
        client
      ).appendAiMessage(append.build());

      done(
        client,
        new AiStreamDonePayload(
          streamId,
          ticketId,
          persisted.getId(),
          content,
          citations.stream().map(AiStreamService::toCitationPayload).toList(),
          false,
          frameAnswerStatus(completion.getStatus())
        )
      );
    } catch (RuntimeException failure) {
      fail(client, streamId, ticketId, clientText(failure));
    }
  }

  private List<Rag.ConversationTurn> transcript(
    String ticketId,
    JwtPrincipal principal,
    SocketIOClient client
  ) {
    ListMessagesResponse page = messagesWith(principal, client).listMessages(
      ListMessagesRequest.newBuilder()
        .setTicketId(ticketId)
        .setPage(
          PageRequest.newBuilder()
            .setPage(1)
            .setLimit(TRANSCRIPT_TURNS)
            .setSortBy("createdAt")
            .setSortOrder(SortOrder.SORT_ORDER_DESC)
        )
        .build()
    );

    List<MessageResponse> newestFirst = page.getItemsList();
    List<Rag.ConversationTurn> turns = new java.util.ArrayList<>();
    for (int i = newestFirst.size() - 1; i >= 0; i--) {
      MessageResponse item = newestFirst.get(i);
      if (item.getExcludedFromAiContext()) {
        continue;
      }

      boolean assistant = item.getIsAiGenerated() || !item.hasSenderId();
      turns.add(
        Rag.ConversationTurn.newBuilder()
          .setRole(assistant ? "assistant" : "user")
          .setContent(item.getContent())
          .build()
      );
    }

    return turns;
  }

  private record AttachmentsResult(
    List<Rag.AttachmentPart> parts,
    List<String> skipped
  ) {}

  private AttachmentsResult aiAttachments(
    String messageId,
    JwtPrincipal principal,
    SocketIOClient client
  ) {
    GetAiAttachmentsResponse response = messagesWith(
      principal,
      client
    ).getAiAttachments(
      GetAiAttachmentsRequest.newBuilder().setMessageId(messageId).build()
    );

    List<Rag.AttachmentPart> parts = response
      .getPartsList()
      .stream()
      .map(part ->
        Rag.AttachmentPart.newBuilder()
          .setMimeType(part.getMimeType())
          .setData(part.getData())
          .setFileName(part.getFileName())
          .build()
      )
      .toList();

    return new AttachmentsResult(parts, response.getSkippedList());
  }

  private void notifySkipped(
    SocketIOClient client,
    String ticketId,
    List<String> fileNames
  ) {
    client.sendEvent(
      RealtimeEvents.REALTIME_EVENTS_AI_STREAM_ATTACHMENTS_SKIPPED,
      WsResponse.ok(
        "Attachments skipped",
        new AiStreamAttachmentsSkippedPayload(ticketId, fileNames)
      )
    );
  }

  private void done(SocketIOClient client, AiStreamDonePayload payload) {
    client.sendEvent(
      RealtimeEvents.REALTIME_EVENTS_AI_STREAM_DONE,
      WsResponse.ok("Stream finished", payload)
    );
  }

  private void fail(
    SocketIOClient client,
    String streamId,
    String ticketId,
    String message
  ) {
    client.sendEvent(
      RealtimeEvents.REALTIME_EVENTS_AI_STREAM_ERROR,
      new WsResponse<>(
        false,
        message,
        new AiStreamErrorPayload(streamId, ticketId)
      )
    );
  }

  private void forget(SocketIOClient client, String streamId) {
    Map<String, LiveStream> forSocket = streamsBySession.get(
      client.getSessionId()
    );
    if (forSocket != null) {
      forSocket.remove(streamId);
    }
  }

  /** rag's {@code Citation} -> ticket-service's structurally identical {@code DraftCitation}. */
  private synapsedesk.ticket.Ai.DraftCitation toDraftCitation(
    Rag.Citation citation
  ) {
    synapsedesk.ticket.Ai.DraftCitation.Builder builder =
      synapsedesk.ticket.Ai.DraftCitation.newBuilder()
        .setChunkId(citation.getChunkId())
        .setDocumentId(citation.getDocumentId())
        .setDocumentTitle(citation.getDocumentTitle())
        .setVectorPointId(citation.getVectorPointId());
    if (citation.hasPageNumber()) {
      builder.setPageNumber(citation.getPageNumber());
    }

    return builder.build();
  }

  private static CitationPayload toCitationPayload(Rag.Citation citation) {
    return new CitationPayload(
      citation.getChunkId(),
      citation.getDocumentId(),
      citation.getDocumentTitle(),
      citation.hasPageNumber() ? citation.getPageNumber() : null,
      citation.getVectorPointId()
    );
  }

  private static MessageAnswerStatus toMessageAnswerStatus(
    AnswerStatus status
  ) {
    return MessageAnswerStatus.valueOf(
      "MESSAGE_ANSWER_STATUS_" + status.name().replace("ANSWER_STATUS_", "")
    );
  }

  private static String frameAnswerStatus(AnswerStatus status) {
    return status.name().replace("ANSWER_STATUS_", "");
  }

  private static String clientText(RuntimeException failure) {
    if (failure instanceof StatusRuntimeException grpc) {
      return GrpcStatusMapping.resolve(
        grpc.getStatus().getCode(),
        grpc.getStatus().getDescription()
      ).message();
    }

    return "The answer stream failed";
  }

  private MessageServiceGrpc.MessageServiceBlockingStub messagesWith(
    JwtPrincipal principal,
    SocketIOClient client
  ) {
    return messages
      .withDeadlineAfter(UNARY_DEADLINE_SECONDS, TimeUnit.SECONDS)
      .withInterceptors(
        MetadataUtils.newAttachHeadersInterceptor(
          CallerMetadata.of(SocketRequestContext.from(principal, client))
        )
      );
  }

  private TicketServiceGrpc.TicketServiceBlockingStub ticketsWith(
    JwtPrincipal principal,
    SocketIOClient client
  ) {
    return tickets
      .withDeadlineAfter(UNARY_DEADLINE_SECONDS, TimeUnit.SECONDS)
      .withInterceptors(
        MetadataUtils.newAttachHeadersInterceptor(
          CallerMetadata.of(SocketRequestContext.from(principal, client))
        )
      );
  }

  /** No deadline — a generation can legitimately run far longer than a unary call. */
  private RagServiceGrpc.RagServiceBlockingStub ragWith(
    JwtPrincipal principal,
    SocketIOClient client
  ) {
    return rag.withInterceptors(
      MetadataUtils.newAttachHeadersInterceptor(
        CallerMetadata.of(SocketRequestContext.from(principal, client))
      )
    );
  }
}
