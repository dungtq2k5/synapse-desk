package com.synapsedesk.gateway.chat;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import com.synapsedesk.gateway.auth.CurrentRequest;
import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.generated.api.ChatApi;
import com.synapsedesk.gateway.generated.model.AttachmentResponseDto;
import com.synapsedesk.gateway.generated.model.CitationResponseDto;
import com.synapsedesk.gateway.generated.model.CreateMessageDto;
import com.synapsedesk.gateway.generated.model.CreateMessageResponseDto;
import com.synapsedesk.gateway.generated.model.InvitationsControllerListV1200ResponseDataMeta;
import com.synapsedesk.gateway.generated.model.MessageResponseDto;
import com.synapsedesk.gateway.generated.model.MessagesControllerCreateV1201Response;
import com.synapsedesk.gateway.generated.model.MessagesControllerListV1200Response;
import com.synapsedesk.gateway.generated.model.MessagesControllerListV1200ResponseData;
import com.synapsedesk.gateway.generated.model.StartConversationDto;
import com.synapsedesk.gateway.generated.model.TicketResponseDto;
import com.synapsedesk.gateway.generated.model.TicketsControllerCreateV1201Response;
import com.synapsedesk.gateway.generated.model.TicketsControllerListV1200Response;
import com.synapsedesk.gateway.generated.model.TicketsControllerListV1200ResponseData;
import com.synapsedesk.gateway.grpc.CallerMetadata;

import io.grpc.stub.MetadataUtils;
import synapsedesk.auth.Common.PageMeta;
import synapsedesk.auth.Common.PageRequest;
import synapsedesk.auth.Common.SortOrder;
import synapsedesk.ticket.Common.TicketPriority;
import synapsedesk.ticket.Common.TicketResponse;
import synapsedesk.ticket.Common.TicketSource;
import synapsedesk.ticket.Common.TicketStatus;
import synapsedesk.ticket.Message.AttachmentResponse;
import synapsedesk.ticket.Message.CreateMessageRequest;
import synapsedesk.ticket.Message.CreateMessageResponse;
import synapsedesk.ticket.Message.ListMessagesRequest;
import synapsedesk.ticket.Message.ListMessagesResponse;
import synapsedesk.ticket.Message.MessageAnswerStatus;
import synapsedesk.ticket.Message.MessageResponse;
import synapsedesk.ticket.MessageServiceGrpc;
import synapsedesk.ticket.Ticket.CreateTicketRequest;
import synapsedesk.ticket.Ticket.ListTicketsRequest;
import synapsedesk.ticket.Ticket.ListTicketsResponse;
import synapsedesk.ticket.Ticket.TicketStatusActionRequest;
import synapsedesk.ticket.TicketServiceGrpc;

/**
 * `ChatApi` — a thin wrapper, exactly as `chat.controller.ts` is: every route
 * forwards to the same `TicketService`/`MessageService` RPCs `TicketsApi` and
 * `MessagesApi` would use, since a "conversation" IS a ticket with
 * {@code source = CHAT}. Reuses the `ticket-service` channel plan 84's
 * `Feedback` module paid for.
 *
 * <p><b>{@code isInternalNote} is forced false</b> on {@link #chatControllerSendMessageV1}
 * — never read from the body — because an end-user surface has no notion of an
 * agent-only note, and forwarding the flag would leave a permission check as
 * the only thing stopping a chat client from writing one.
 */
@RestController
public class ChatController implements ChatApi {

  private static final long DEADLINE_SECONDS = 5;

  private final TicketServiceGrpc.TicketServiceBlockingStub tickets;
  private final MessageServiceGrpc.MessageServiceBlockingStub messages;
  private final CurrentUser currentUser;

  public ChatController(
      TicketServiceGrpc.TicketServiceBlockingStub tickets,
      MessageServiceGrpc.MessageServiceBlockingStub messages,
      CurrentUser currentUser) {
    this.tickets = tickets;
    this.messages = messages;
    this.currentUser = currentUser;
  }

  private TicketServiceGrpc.TicketServiceBlockingStub ticketsWith(RequestContext context) {
    return tickets
        .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
        .withInterceptors(MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context)));
  }

  private MessageServiceGrpc.MessageServiceBlockingStub messagesWith(RequestContext context) {
    return messages
        .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
        .withInterceptors(MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context)));
  }

  @Override
  public ResponseEntity<TicketsControllerCreateV1201Response> chatControllerStartV1(
      StartConversationDto startConversationDto) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    CreateTicketRequest.Builder wire =
        CreateTicketRequest.newBuilder()
            .setTitle(startConversationDto.getTitle())
            .setDescription(startConversationDto.getMessage())
            // The ONLY thing that distinguishes a conversation from a ticket —
            // set here, never accepted from the body, so a client cannot open a
            // chat that reports itself as having arrived by another source.
            .setSource(TicketSource.TICKET_SOURCE_CHAT);
    if (startConversationDto.getPriority() != null) {
      // FIXME A "NullPointerException" could be thrown; "getPriority()" can return null. [+2 locations]
      wire.setPriority(toProtoPriority(startConversationDto.getPriority().getValue()));
    }

    TicketResponse response = ticketsWith(context).createTicket(wire.build());

    return new ResponseEntity<>(
        new TicketsControllerCreateV1201Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(201))
            .message("Conversation started")
            .data(toTicketDto(response)),
        HttpStatus.CREATED);
  }

  @Override
  public ResponseEntity<TicketsControllerListV1200Response> chatControllerListV1(
      BigDecimal page,
      BigDecimal limit,
      String sortOrder,
      String searchTerm,
      String sortBy,
      Boolean includeDeleted,
      String status,
      String priority,
      String source,
      UUID assigneeId,
      UUID departmentId,
      UUID authorId) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    PageRequest.Builder pageRequest =
        PageRequest.newBuilder()
            .setPage(page.intValue())
            .setLimit(limit.intValue())
            .setSortBy(sortBy)
            .setSortOrder("DESC".equalsIgnoreCase(sortOrder) ? SortOrder.SORT_ORDER_DESC : SortOrder.SORT_ORDER_ASC);
    if (searchTerm != null) {
      pageRequest.setSearchTerm(searchTerm);
    }

    ListTicketsRequest wire =
        ListTicketsRequest.newBuilder()
            .setPage(pageRequest)
            // `source=CHAT` forced and `authorId` pinned to the caller — the
            // caller's OWN conversations, never the tenant queue
            // `ticket.read.all` would otherwise expose.
            .setSource(TicketSource.TICKET_SOURCE_CHAT)
            .setAuthorId(context.sub())
            .setIncludeDeleted(false)
            .build();

    ListTicketsResponse response = ticketsWith(context).listTickets(wire);

    TicketsControllerListV1200ResponseData data =
        new TicketsControllerListV1200ResponseData()
            .items(response.getItemsList().stream().map(ChatController::toTicketDto).toList())
            .meta(toMetaDto(response.getMeta()));

    return ResponseEntity.ok(
        new TicketsControllerListV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(data));
  }

  @Override
  public ResponseEntity<TicketsControllerCreateV1201Response> chatControllerGetV1(String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    TicketResponse response =
        ticketsWith(context).getTicket(synapsedesk.ticket.Ticket.GetTicketRequest.newBuilder().setId(id).build());

    return ResponseEntity.ok(
        new TicketsControllerCreateV1201Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(toTicketDto(response)));
  }

  @Override
  public ResponseEntity<MessagesControllerListV1200Response> chatControllerListMessagesV1(
      String id, BigDecimal page, BigDecimal limit, String sortBy, String sortOrder, String searchTerm) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    PageRequest.Builder pageRequest =
        PageRequest.newBuilder()
            .setPage(page.intValue())
            .setLimit(limit.intValue())
            .setSortBy(sortBy)
            .setSortOrder("DESC".equalsIgnoreCase(sortOrder) ? SortOrder.SORT_ORDER_DESC : SortOrder.SORT_ORDER_ASC);
    if (searchTerm != null) {
      pageRequest.setSearchTerm(searchTerm);
    }

    ListMessagesResponse response =
        messagesWith(context)
            .listMessages(ListMessagesRequest.newBuilder().setTicketId(id).setPage(pageRequest).build());

    MessagesControllerListV1200ResponseData data =
        new MessagesControllerListV1200ResponseData()
            .items(response.getItemsList().stream().map(ChatController::toMessageDto).toList())
            .meta(toMetaDto(response.getMeta()));

    return ResponseEntity.ok(
        new MessagesControllerListV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(data));
  }

  @Override
  public ResponseEntity<MessagesControllerCreateV1201Response> chatControllerSendMessageV1(
      String id, CreateMessageDto createMessageDto) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    CreateMessageRequest wire =
        CreateMessageRequest.newBuilder()
            .setTicketId(id)
            .setContent(createMessageDto.getContent())
            // Forced false — never `createMessageDto.getIsInternalNote()` — an
            // end-user surface has no notion of an agent-only note.
            .setIsInternalNote(false)
            .setInvokeAi(Boolean.TRUE.equals(createMessageDto.getInvokeAi()))
            .build();

    CreateMessageResponse response = messagesWith(context).createMessage(wire);

    CreateMessageResponseDto data =
        new CreateMessageResponseDto()
            .message(toMessageDto(response.getMessage()))
            .skippedAttachments(response.getSkippedAttachmentsList());

    return new ResponseEntity<>(
        new MessagesControllerCreateV1201Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(201))
            .message("Message sent")
            .data(data),
        HttpStatus.CREATED);
  }

  @Override
  public ResponseEntity<TicketsControllerCreateV1201Response> chatControllerEscalateV1(String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    // `{}` and NOT a chat-specific reason — a literal alias of
    // `POST /tickets/:id/escalate`, asserted as one.
    TicketResponse response =
        ticketsWith(context).escalateTicket(TicketStatusActionRequest.newBuilder().setTicketId(id).build());

    return ResponseEntity.ok(
        new TicketsControllerCreateV1201Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("Handed off to an agent")
            .data(toTicketDto(response)));
  }

  private static TicketResponseDto toTicketDto(TicketResponse ticket) {
    return new TicketResponseDto()
        .id(ticket.getId())
        .ticketNumber(BigDecimal.valueOf(ticket.getTicketNumber()))
        .organizationId(ticket.getOrganizationId())
        .authorId(ticket.getAuthorId())
        .source(toSourceEnum(ticket.getSource()))
        .status(toStatusEnum(ticket.getStatus()))
        .priority(toPriorityEnum(ticket.getPriority()))
        .title(ticket.getTitle())
        .description(ticket.getDescription())
        .currentAssigneeId(ticket.hasCurrentAssigneeId() ? ticket.getCurrentAssigneeId() : null)
        .currentDepartmentId(ticket.hasCurrentDepartmentId() ? ticket.getCurrentDepartmentId() : null)
        .escalatedAt(ticket.hasEscalatedAt() ? toOffsetDateTime(ticket.getEscalatedAt()) : null)
        .resolvedAt(ticket.hasResolvedAt() ? toOffsetDateTime(ticket.getResolvedAt()) : null)
        .unreadCount(BigDecimal.valueOf(ticket.getUnreadCount()))
        .createdAt(toOffsetDateTime(ticket.getCreatedAt()))
        .updatedAt(toOffsetDateTime(ticket.getUpdatedAt()))
        .deletedAt(ticket.hasDeletedAt() ? toOffsetDateTime(ticket.getDeletedAt()) : null)
        .deletedById(ticket.hasDeletedById() ? ticket.getDeletedById() : null);
  }

  private static MessageResponseDto toMessageDto(MessageResponse message) {
    List<CitationResponseDto> citations =
        message.hasCitations()
            ? message.getCitations().getItemsList().stream().map(ChatController::toCitationDto).toList()
            : null;

    return new MessageResponseDto()
        .id(message.getId())
        .ticketId(message.getTicketId())
        .senderId(message.hasSenderId() ? message.getSenderId() : null)
        .content(message.getContent())
        .isAiGenerated(message.getIsAiGenerated())
        .isInternalNote(message.getIsInternalNote())
        .modelName(message.hasModelName() ? message.getModelName() : null)
        .promptTokens(message.hasPromptTokens() ? BigDecimal.valueOf(message.getPromptTokens()) : null)
        .completionTokens(
            message.hasCompletionTokens() ? BigDecimal.valueOf(message.getCompletionTokens()) : null)
        .editedAt(message.hasEditedAt() ? toOffsetDateTime(message.getEditedAt()) : null)
        .redactedAt(message.hasRedactedAt() ? toOffsetDateTime(message.getRedactedAt()) : null)
        .createdAt(toOffsetDateTime(message.getCreatedAt()))
        .attachments(message.getAttachmentsList().stream().map(ChatController::toAttachmentDto).toList())
        .excludedFromAiContext(message.getExcludedFromAiContext())
        .answerStatus(toAnswerStatusEnum(message.getAnswerStatus()))
        .citations(citations);
  }

  private static AttachmentResponseDto toAttachmentDto(AttachmentResponse attachment) {
    return new AttachmentResponseDto()
        .id(attachment.getId())
        .messageId(attachment.getMessageId())
        .fileName(attachment.getFileName())
        .fileUrl(attachment.getFileUrl())
        .fileSizeBytes(BigDecimal.valueOf(attachment.getFileSizeBytes()))
        .mimeType(attachment.getMimeType())
        .createdAt(toOffsetDateTime(attachment.getCreatedAt()));
  }

  private static CitationResponseDto toCitationDto(synapsedesk.ticket.Ai.DraftCitation citation) {
    return new CitationResponseDto()
        .chunkId(citation.getChunkId())
        .documentId(citation.getDocumentId())
        .documentTitle(citation.getDocumentTitle())
        .pageNumber(citation.hasPageNumber() ? BigDecimal.valueOf(citation.getPageNumber()) : null)
        .vectorPointId(citation.getVectorPointId());
  }

  private static InvitationsControllerListV1200ResponseDataMeta toMetaDto(PageMeta meta) {
    return new InvitationsControllerListV1200ResponseDataMeta(
        BigDecimal.valueOf(meta.getTotalItems()),
        BigDecimal.valueOf(meta.getItemCount()),
        BigDecimal.valueOf(meta.getItemsPerPage()),
        BigDecimal.valueOf(meta.getTotalPages()),
        BigDecimal.valueOf(meta.getCurrentPage()));
  }

  /** `TICKET_SOURCE_CHAT` -> `CHAT` — `fromValue` answers null for UNSPECIFIED, matching `fromProtoTicketSource`. */
  private static TicketResponseDto.SourceEnum toSourceEnum(TicketSource source) {
    return TicketResponseDto.SourceEnum.fromValue(source.name().replace("TICKET_SOURCE_", ""));
  }

  private static TicketResponseDto.StatusEnum toStatusEnum(TicketStatus status) {
    return TicketResponseDto.StatusEnum.fromValue(status.name().replace("TICKET_STATUS_", ""));
  }

  private static TicketResponseDto.PriorityEnum toPriorityEnum(TicketPriority priority) {
    return TicketResponseDto.PriorityEnum.fromValue(priority.name().replace("TICKET_PRIORITY_", ""));
  }

  private static TicketPriority toProtoPriority(String value) {
    return TicketPriority.valueOf("TICKET_PRIORITY_" + value);
  }

  private static MessageResponseDto.AnswerStatusEnum toAnswerStatusEnum(MessageAnswerStatus status) {
    return MessageResponseDto.AnswerStatusEnum.fromValue(status.name().replace("MESSAGE_ANSWER_STATUS_", ""));
  }

  private static OffsetDateTime toOffsetDateTime(com.google.protobuf.Timestamp timestamp) {
    return Instant.ofEpochSecond(timestamp.getSeconds(), timestamp.getNanos()).atOffset(ZoneOffset.UTC);
  }
}
