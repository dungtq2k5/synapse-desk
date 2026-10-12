package com.synapsedesk.gateway.modules.chat;

import com.synapsedesk.gateway.common.auth.CurrentRequest;
import com.synapsedesk.gateway.common.auth.CurrentUser;
import com.synapsedesk.gateway.common.auth.RequestContext;
import com.synapsedesk.gateway.common.dto.CitationResponseDto;
import com.synapsedesk.gateway.common.grpc.CallerMetadata;
import com.synapsedesk.gateway.common.openapi.ApiErrors;
import com.synapsedesk.gateway.common.web.ApiPaths;
import com.synapsedesk.gateway.common.web.ApiResponse;
import com.synapsedesk.gateway.common.web.PageMeta;
import com.synapsedesk.gateway.common.web.PagedData;
import com.synapsedesk.gateway.common.web.SortDirection;
import com.synapsedesk.gateway.modules.chat.dto.rest.StartConversationDto;
import com.synapsedesk.gateway.modules.tickets.TicketReferences;
import com.synapsedesk.gateway.modules.tickets.dto.rest.AttachmentResponseDto;
import com.synapsedesk.gateway.modules.tickets.dto.rest.CreateMessageDto;
import com.synapsedesk.gateway.modules.tickets.dto.rest.CreateMessageResponseDto;
import com.synapsedesk.gateway.modules.tickets.dto.rest.MessageResponseDto;
import com.synapsedesk.gateway.modules.tickets.dto.rest.TicketPriorityFilter;
import com.synapsedesk.gateway.modules.tickets.dto.rest.TicketResponseDto;
import com.synapsedesk.gateway.modules.tickets.dto.rest.TicketSortField;
import com.synapsedesk.gateway.modules.tickets.dto.rest.TicketSourceFilter;
import com.synapsedesk.gateway.modules.tickets.dto.rest.TicketStatusFilter;
import io.grpc.stub.MetadataUtils;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.jspecify.annotations.Nullable;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
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
 * `ChatApi` — a thin wrapper: every route forwards to the same
 * `TicketService`/`MessageService` RPCs `TicketsApi` and `MessagesApi` would
 * use, since a "conversation" IS a ticket with {@code source = CHAT}. Reuses the `ticket-service` channel the `Feedback`
 * module paid for.
 *
 * <p><b>{@code isInternalNote} is forced false</b> on {@link #chatControllerSendMessageV1}
 * — never read from the body — because an end-user surface has no notion of an
 * agent-only note, and forwarding the flag would leave a permission check as
 * the only thing stopping a chat client from writing one.
 *
 * <p><b>Migrated off `ChatApi`.</b> `start`/`sendMessage` answer 201 —
 * {@code @ResponseStatus} is what tells springdoc that.
 */
@Tag(name = "Chat")
@RestController
@RequestMapping(ApiPaths.V1)
@Validated
public class ChatController {

  private static final long DEADLINE_SECONDS = 5;

  private final TicketServiceGrpc.TicketServiceBlockingStub tickets;
  private final MessageServiceGrpc.MessageServiceBlockingStub messages;
  private final CurrentUser currentUser;
  private final TicketReferences references;

  public ChatController(
    TicketServiceGrpc.TicketServiceBlockingStub tickets,
    MessageServiceGrpc.MessageServiceBlockingStub messages,
    CurrentUser currentUser,
    TicketReferences references
  ) {
    this.tickets = tickets;
    this.messages = messages;
    this.currentUser = currentUser;
    this.references = references;
  }

  private TicketServiceGrpc.TicketServiceBlockingStub ticketsWith(
    RequestContext context
  ) {
    return tickets
      .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
      .withInterceptors(
        MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context))
      );
  }

  private MessageServiceGrpc.MessageServiceBlockingStub messagesWith(
    RequestContext context
  ) {
    return messages
      .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
      .withInterceptors(
        MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context))
      );
  }

  @PostMapping(
    value = "/chat/conversations",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401" })
  @ResponseStatus(HttpStatus.CREATED)
  public ResponseEntity<ApiResponse<TicketResponseDto>> chatControllerStartV1(
    @Valid @RequestBody StartConversationDto startConversationDto
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    CreateTicketRequest.Builder wire = CreateTicketRequest.newBuilder()
      .setTitle(startConversationDto.getTitle())
      .setDescription(startConversationDto.getMessage())
      // The ONLY thing that distinguishes a conversation from a ticket —
      // set here, never accepted from the body, so a client cannot open a
      // chat that reports itself as having arrived by another source.
      .setSource(TicketSource.TICKET_SOURCE_CHAT);
    StartConversationDto.PriorityEnum priority =
      startConversationDto.getPriority();
    if (priority != null) {
      wire.setPriority(toProtoPriority(priority.getValue()));
    }

    TicketResponse response = ticketsWith(context).createTicket(wire.build());

    return new ResponseEntity<>(
      ApiResponse.of(
        201,
        "Conversation started",
        withNames(context, toTicketDto(response))
      ),
      HttpStatus.CREATED
    );
  }

  @GetMapping(value = "/chat/conversations", produces = { "application/json" })
  @ApiErrors({ "401" })
  public ResponseEntity<
    ApiResponse<PagedData<TicketResponseDto>>
  > chatControllerListV1(
    @DecimalMin(value = "1") @Valid @RequestParam(
      value = "page",
      required = false,
      defaultValue = "1"
    ) BigDecimal page,
    @DecimalMin(value = "1") @DecimalMax(value = "100") @Valid @RequestParam(
      value = "limit",
      required = false,
      defaultValue = "10"
    ) BigDecimal limit,
    @Valid @RequestParam(
      value = "sortOrder",
      required = false,
      defaultValue = "ASC"
    ) SortDirection sortOrder,
    @Valid @RequestParam(
      value = "searchTerm",
      required = false
    ) @Nullable String searchTerm,
    @Valid @RequestParam(
      value = "sortBy",
      required = false,
      defaultValue = "createdAt"
    ) TicketSortField sortBy,
    @Valid @RequestParam(
      value = "includeDeleted",
      required = false,
      defaultValue = "false"
    ) Boolean includeDeleted,
    @Valid @RequestParam(
      value = "status",
      required = false
    ) @Nullable TicketStatusFilter status,
    @Valid @RequestParam(
      value = "priority",
      required = false
    ) @Nullable TicketPriorityFilter priority,
    @Valid @RequestParam(
      value = "source",
      required = false
    ) @Nullable TicketSourceFilter source,
    @Valid @RequestParam(
      value = "assigneeId",
      required = false
    ) @Nullable UUID assigneeId,
    @Valid @RequestParam(
      value = "departmentId",
      required = false
    ) @Nullable UUID departmentId,
    @Valid @RequestParam(
      value = "authorId",
      required = false
    ) @Nullable UUID authorId
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    PageRequest.Builder pageRequest = PageRequest.newBuilder()
      .setPage(page.intValue())
      .setLimit(limit.intValue())
      .setSortBy(sortBy.name())
      .setSortOrder(
        sortOrder == SortDirection.DESC
          ? SortOrder.SORT_ORDER_DESC
          : SortOrder.SORT_ORDER_ASC
      );
    if (searchTerm != null) {
      pageRequest.setSearchTerm(searchTerm);
    }

    ListTicketsRequest.Builder wire = ListTicketsRequest.newBuilder()
      .setPage(pageRequest)
      // `source=CHAT` forced and `authorId` pinned to the caller — the
      // caller's OWN conversations, never the tenant queue
      // `ticket.read.all` would otherwise expose.
      .setSource(TicketSource.TICKET_SOURCE_CHAT)
      .setAuthorId(context.sub())
      .setIncludeDeleted(false);

    // The query is spread over the forced values, so `status` and `priority`
    // filter the caller's conversations as they filter the ticket queue; only
    // `source` and `authorId` are pinned. (`source` is accepted and checked as an
    // enum, then overridden: a chat is always source CHAT.)
    if (status != null) {
      wire.setStatus(TicketStatus.valueOf("TICKET_STATUS_" + status.name()));
    }
    if (priority != null) {
      wire.setPriority(
        TicketPriority.valueOf("TICKET_PRIORITY_" + priority.name())
      );
    }

    ListTicketsResponse response = ticketsWith(context).listTickets(
      wire.build()
    );

    List<TicketResponseDto> items = response
      .getItemsList()
      .stream()
      .map(ChatController::toTicketDto)
      .toList();
    references.fillTickets(context, items);
    PagedData<TicketResponseDto> data = new PagedData<>(
      items,
      PageMeta.from(response.getMeta())
    );

    return ResponseEntity.ok(ApiResponse.of(200, "OK", data));
  }

  @GetMapping(
    value = "/chat/conversations/{id}",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "404" })
  public ResponseEntity<ApiResponse<TicketResponseDto>> chatControllerGetV1(
    @PathVariable("id") String id
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    TicketResponse response = ticketsWith(context).getTicket(
      synapsedesk.ticket.Ticket.GetTicketRequest.newBuilder().setId(id).build()
    );

    return ResponseEntity.ok(
      ApiResponse.of(200, "OK", withNames(context, toTicketDto(response)))
    );
  }

  @GetMapping(
    value = "/chat/conversations/{id}/messages",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "404" })
  public ResponseEntity<
    ApiResponse<PagedData<MessageResponseDto>>
  > chatControllerListMessagesV1(
    @PathVariable("id") String id,
    @DecimalMin(value = "1") @Valid @RequestParam(
      value = "page",
      required = false,
      defaultValue = "1"
    ) BigDecimal page,
    @DecimalMin(value = "1") @DecimalMax(value = "100") @Valid @RequestParam(
      value = "limit",
      required = false,
      defaultValue = "10"
    ) BigDecimal limit,
    @Valid @RequestParam(
      value = "sortBy",
      required = false,
      defaultValue = "createdAt"
    ) String sortBy,
    @Valid @RequestParam(
      value = "sortOrder",
      required = false,
      defaultValue = "ASC"
    ) SortDirection sortOrder,
    @Valid @RequestParam(
      value = "searchTerm",
      required = false
    ) @Nullable String searchTerm
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    PageRequest.Builder pageRequest = PageRequest.newBuilder()
      .setPage(page.intValue())
      .setLimit(limit.intValue())
      .setSortBy(sortBy)
      .setSortOrder(
        sortOrder == SortDirection.DESC
          ? SortOrder.SORT_ORDER_DESC
          : SortOrder.SORT_ORDER_ASC
      );
    if (searchTerm != null) {
      pageRequest.setSearchTerm(searchTerm);
    }

    ListMessagesResponse response = messagesWith(context).listMessages(
      ListMessagesRequest.newBuilder()
        .setTicketId(id)
        .setPage(pageRequest)
        .build()
    );

    List<MessageResponseDto> items = response
      .getItemsList()
      .stream()
      .map(ChatController::toMessageDto)
      .toList();
    references.fillMessages(context, items);
    PagedData<MessageResponseDto> data = new PagedData<>(
      items,
      PageMeta.from(response.getMeta())
    );

    return ResponseEntity.ok(ApiResponse.of(200, "OK", data));
  }

  @PostMapping(
    value = "/chat/conversations/{id}/messages",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "404" })
  @ResponseStatus(HttpStatus.CREATED)
  public ResponseEntity<
    ApiResponse<CreateMessageResponseDto>
  > chatControllerSendMessageV1(
    @PathVariable("id") String id,
    @Valid @RequestBody CreateMessageDto createMessageDto
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    CreateMessageRequest wire = CreateMessageRequest.newBuilder()
      .setTicketId(id)
      .setContent(createMessageDto.getContent())
      // Forced false — never `createMessageDto.getIsInternalNote()` — an
      // end-user surface has no notion of an agent-only note.
      .setIsInternalNote(false)
      .setInvokeAi(Boolean.TRUE.equals(createMessageDto.getInvokeAi()))
      .build();

    CreateMessageResponse response = messagesWith(context).createMessage(wire);

    CreateMessageResponseDto data = new CreateMessageResponseDto(
      withSender(context, toMessageDto(response.getMessage())),
      response.getSkippedAttachmentsList()
    );

    return new ResponseEntity<>(
      ApiResponse.of(201, "Message sent", data),
      HttpStatus.CREATED
    );
  }

  @PostMapping(
    value = "/chat/conversations/{id}/escalate",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "404" })
  public ResponseEntity<
    ApiResponse<TicketResponseDto>
  > chatControllerEscalateV1(@PathVariable("id") String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    // `{}` and NOT a chat-specific reason — a literal alias of
    // `POST /tickets/:id/escalate`, asserted as one.
    TicketResponse response = ticketsWith(context).escalateTicket(
      TicketStatusActionRequest.newBuilder().setTicketId(id).build()
    );

    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "Handed off to an agent",
        withNames(context, toTicketDto(response))
      )
    );
  }

  private TicketResponseDto withNames(
    RequestContext context,
    TicketResponseDto ticket
  ) {
    references.fillTickets(context, List.of(ticket));
    return ticket;
  }

  private MessageResponseDto withSender(
    RequestContext context,
    MessageResponseDto message
  ) {
    references.fillMessages(context, List.of(message));
    return message;
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
      .currentAssigneeId(
        ticket.hasCurrentAssigneeId() ? ticket.getCurrentAssigneeId() : null
      )
      .currentDepartmentId(
        ticket.hasCurrentDepartmentId() ? ticket.getCurrentDepartmentId() : null
      )
      .escalatedAt(
        ticket.hasEscalatedAt()
          ? toOffsetDateTime(ticket.getEscalatedAt())
          : null
      )
      .resolvedAt(
        ticket.hasResolvedAt() ? toOffsetDateTime(ticket.getResolvedAt()) : null
      )
      .unreadCount(BigDecimal.valueOf(ticket.getUnreadCount()))
      .createdAt(toOffsetDateTime(ticket.getCreatedAt()))
      .updatedAt(toOffsetDateTime(ticket.getUpdatedAt()))
      .deletedAt(
        ticket.hasDeletedAt() ? toOffsetDateTime(ticket.getDeletedAt()) : null
      )
      .deletedById(ticket.hasDeletedById() ? ticket.getDeletedById() : null);
  }

  private static MessageResponseDto toMessageDto(MessageResponse message) {
    List<CitationResponseDto> citations = message.hasCitations()
      ? message
          .getCitations()
          .getItemsList()
          .stream()
          .map(ChatController::toCitationDto)
          .toList()
      : null;

    return new MessageResponseDto()
      .id(message.getId())
      .ticketId(message.getTicketId())
      .senderId(message.hasSenderId() ? message.getSenderId() : null)
      .content(message.getContent())
      .isAiGenerated(message.getIsAiGenerated())
      .isInternalNote(message.getIsInternalNote())
      .modelName(message.hasModelName() ? message.getModelName() : null)
      .promptTokens(
        message.hasPromptTokens()
          ? BigDecimal.valueOf(message.getPromptTokens())
          : null
      )
      .completionTokens(
        message.hasCompletionTokens()
          ? BigDecimal.valueOf(message.getCompletionTokens())
          : null
      )
      .editedAt(
        message.hasEditedAt() ? toOffsetDateTime(message.getEditedAt()) : null
      )
      .redactedAt(
        message.hasRedactedAt()
          ? toOffsetDateTime(message.getRedactedAt())
          : null
      )
      .createdAt(toOffsetDateTime(message.getCreatedAt()))
      .attachments(
        message
          .getAttachmentsList()
          .stream()
          .map(ChatController::toAttachmentDto)
          .toList()
      )
      .excludedFromAiContext(message.getExcludedFromAiContext())
      .answerStatus(toAnswerStatusEnum(message.getAnswerStatus()))
      .citations(citations);
  }

  private static AttachmentResponseDto toAttachmentDto(
    AttachmentResponse attachment
  ) {
    return new AttachmentResponseDto()
      .id(attachment.getId())
      .messageId(attachment.getMessageId())
      .fileName(attachment.getFileName())
      .fileUrl(attachment.getFileUrl())
      .fileSizeBytes(BigDecimal.valueOf(attachment.getFileSizeBytes()))
      .mimeType(attachment.getMimeType())
      .createdAt(toOffsetDateTime(attachment.getCreatedAt()));
  }

  private static CitationResponseDto toCitationDto(
    synapsedesk.ticket.Ai.DraftCitation citation
  ) {
    return new CitationResponseDto()
      .chunkId(citation.getChunkId())
      .documentId(citation.getDocumentId())
      .documentTitle(citation.getDocumentTitle())
      .pageNumber(
        citation.hasPageNumber()
          ? BigDecimal.valueOf(citation.getPageNumber())
          : null
      )
      .vectorPointId(citation.getVectorPointId());
  }

  /** `TICKET_SOURCE_CHAT` -> `CHAT` — `fromValue` answers null for UNSPECIFIED, matching `fromProtoTicketSource`. */
  private static TicketResponseDto.SourceEnum toSourceEnum(
    TicketSource source
  ) {
    return TicketResponseDto.SourceEnum.fromValue(
      source.name().replace("TICKET_SOURCE_", "")
    );
  }

  private static TicketResponseDto.StatusEnum toStatusEnum(
    TicketStatus status
  ) {
    return TicketResponseDto.StatusEnum.fromValue(
      status.name().replace("TICKET_STATUS_", "")
    );
  }

  private static TicketResponseDto.PriorityEnum toPriorityEnum(
    TicketPriority priority
  ) {
    return TicketResponseDto.PriorityEnum.fromValue(
      priority.name().replace("TICKET_PRIORITY_", "")
    );
  }

  private static TicketPriority toProtoPriority(String value) {
    return TicketPriority.valueOf("TICKET_PRIORITY_" + value);
  }

  private static MessageResponseDto.AnswerStatusEnum toAnswerStatusEnum(
    MessageAnswerStatus status
  ) {
    return MessageResponseDto.AnswerStatusEnum.fromValue(
      status.name().replace("MESSAGE_ANSWER_STATUS_", "")
    );
  }

  private static OffsetDateTime toOffsetDateTime(
    com.google.protobuf.Timestamp timestamp
  ) {
    return Instant.ofEpochSecond(
      timestamp.getSeconds(),
      timestamp.getNanos()
    ).atOffset(ZoneOffset.UTC);
  }
}
