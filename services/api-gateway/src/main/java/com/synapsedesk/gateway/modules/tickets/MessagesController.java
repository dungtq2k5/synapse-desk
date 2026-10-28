package com.synapsedesk.gateway.modules.tickets;

import com.synapsedesk.gateway.common.auth.CurrentRequest;
import com.synapsedesk.gateway.common.auth.CurrentUser;
import com.synapsedesk.gateway.common.auth.RequestContext;
import com.synapsedesk.gateway.common.dto.CitationResponseDto;
import com.synapsedesk.gateway.common.dto.CurrentUserResponseDto.PermissionCodesEnum;
import com.synapsedesk.gateway.common.dto.UploadMethod;
import com.synapsedesk.gateway.common.grpc.CallerMetadata;
import com.synapsedesk.gateway.common.openapi.ApiErrors;
import com.synapsedesk.gateway.common.security.RequirePermission;
import com.synapsedesk.gateway.common.web.ApiPaths;
import com.synapsedesk.gateway.common.web.ApiResponse;
import com.synapsedesk.gateway.common.web.PageMeta;
import com.synapsedesk.gateway.common.web.PagedData;
import com.synapsedesk.gateway.common.web.SortDirection;
import com.synapsedesk.gateway.modules.tickets.dto.rest.AttachmentResponseDto;
import com.synapsedesk.gateway.modules.tickets.dto.rest.ConfirmAttachmentDto;
import com.synapsedesk.gateway.modules.tickets.dto.rest.CreateMessageDto;
import com.synapsedesk.gateway.modules.tickets.dto.rest.CreateMessageResponseDto;
import com.synapsedesk.gateway.modules.tickets.dto.rest.MessageResponseDto;
import com.synapsedesk.gateway.modules.tickets.dto.rest.PresignAttachmentResponseDto;
import com.synapsedesk.gateway.modules.tickets.dto.rest.UpdateMessageDto;
import com.synapsedesk.gateway.modules.tickets.dto.rest.UploadAttachmentDto;
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
import java.util.concurrent.TimeUnit;
import org.jspecify.annotations.Nullable;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import synapsedesk.auth.Common.PageRequest;
import synapsedesk.auth.Common.SortOrder;
import synapsedesk.ticket.Ai.DraftCitation;
import synapsedesk.ticket.Common.AttachmentResponse;
import synapsedesk.ticket.Message.ConfirmAttachmentRequest;
import synapsedesk.ticket.Message.CreateMessageRequest;
import synapsedesk.ticket.Message.CreateMessageResponse;
import synapsedesk.ticket.Message.ListAttachmentsRequest;
import synapsedesk.ticket.Message.ListMessagesRequest;
import synapsedesk.ticket.Message.ListMessagesResponse;
import synapsedesk.ticket.Message.MessageAnswerStatus;
import synapsedesk.ticket.Message.MessageResponse;
import synapsedesk.ticket.Common.NewAttachment;
import synapsedesk.ticket.Message.PresignAttachmentResponse;
import synapsedesk.ticket.Message.RedactMessageRequest;
import synapsedesk.ticket.Message.RedactMessageResponse;
import synapsedesk.ticket.Message.UpdateMessageRequest;
import synapsedesk.ticket.Message.UploadAttachmentRequest;
import synapsedesk.ticket.MessageServiceGrpc;

/**
 * `MessagesApi` — the ticket thread, against ticket-service's
 * `MessageService`.
 *
 * <p>
 * <b>Almost nothing here is permission-gated, and that is deliberate</b> —
 * the thread is how an end user
 * talks to support, so gating reads or replies would make the product's core
 * interaction staff-only. What is restricted lives one layer down, decided
 * PER ROW rather than per route (internal notes stripped in ticket-service's
 * own query for a non-agent; edit ownership and the edit window enforced
 * there too). <b>Only {@code redact} carries a route permission</b>
 * ({@code ticket.message.moderate}) — the one action that is purely
 * moderation. Every other method below carries no {@code @RequirePermission}
 * at all, and none should ever gain one without reasoning as strong as the
 * above.
 *
 * <p>The two presign routes answer {@code {uploadUrl, objectPath, expiresAt}},
 * which {@link PresignAttachmentResponseDto} names. `create`/`confirmAttachment`
 * answer 201 — {@code @ResponseStatus} is what tells springdoc that.
 */
@Tag(name = "Messages")
@RestController
@RequestMapping(ApiPaths.V1)
@Validated
public class MessagesController {

  private static final long DEADLINE_SECONDS = 5;

  private final MessageServiceGrpc.MessageServiceBlockingStub stub;
  private final CurrentUser currentUser;
  private final TicketReferences references;

  public MessagesController(
    MessageServiceGrpc.MessageServiceBlockingStub stub,
    CurrentUser currentUser,
    TicketReferences references
  ) {
    this.stub = stub;
    this.currentUser = currentUser;
    this.references = references;
  }

  @GetMapping(
    value = "/tickets/{ticketId}/messages",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "404" })
  public ResponseEntity<
    ApiResponse<PagedData<MessageResponseDto>>
  > messagesControllerListV1(
    @PathVariable("ticketId") String ticketId,
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

    ListMessagesResponse response = withMetadata(context).listMessages(
      ListMessagesRequest.newBuilder()
        .setTicketId(ticketId)
        .setPage(pageRequest)
        .build()
    );

    List<MessageResponseDto> items = response
      .getItemsList()
      .stream()
      .map(MessagesController::toMessageResponseDto)
      .toList();
    references.fillMessages(context, items);
    PagedData<MessageResponseDto> data = new PagedData<>(
      items,
      PageMeta.from(response.getMeta())
    );

    return ResponseEntity.ok(ApiResponse.of(200, "OK", data));
  }

  @PostMapping(
    value = "/tickets/{ticketId}/messages",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "404" })
  @ResponseStatus(HttpStatus.CREATED)
  public ResponseEntity<
    ApiResponse<CreateMessageResponseDto>
  > messagesControllerCreateV1(
    @PathVariable("ticketId") String ticketId,
    @Valid @RequestBody CreateMessageDto createMessageDto
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    CreateMessageRequest.Builder wire = CreateMessageRequest.newBuilder()
      .setTicketId(ticketId)
      .setContent(createMessageDto.getContent())
      .setIsInternalNote(
        Boolean.TRUE.equals(createMessageDto.getIsInternalNote())
      )
      .setInvokeAi(Boolean.TRUE.equals(createMessageDto.getInvokeAi()))
      .addAllAttachments(
        createMessageDto
          .getAttachments()
          .stream()
          .map(attachment ->
            NewAttachment.newBuilder()
              .setObjectPath(attachment.getObjectPath())
              .setFileName(attachment.getFileName())
              .build()
          )
          .toList()
      );
    var generatedFromId = createMessageDto.getGeneratedFromId();
    if (generatedFromId != null) {
      wire.setGeneratedFromId(generatedFromId.toString());
    }

    CreateMessageResponse response = withMetadata(context).createMessage(
      wire.build()
    );

    MessageResponseDto message = withSender(
      context,
      toMessageResponseDto(response.getMessage())
    );
    CreateMessageResponseDto data = new CreateMessageResponseDto(
      message,
      response.getSkippedAttachmentsList()
    );

    return ResponseEntity.status(HttpStatus.CREATED).body(
      ApiResponse.of(201, "Message posted", data)
    );
  }

  @PatchMapping(
    value = "/tickets/{ticketId}/messages/{messageId}",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "404" })
  public ResponseEntity<
    ApiResponse<MessageResponseDto>
  > messagesControllerUpdateV1(
    @PathVariable("ticketId") String ticketId,
    @PathVariable("messageId") String messageId,
    @Valid @RequestBody UpdateMessageDto updateMessageDto
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    MessageResponse response = withMetadata(context).updateMessage(
      UpdateMessageRequest.newBuilder()
        .setTicketId(ticketId)
        .setMessageId(messageId)
        .setContent(updateMessageDto.getContent())
        .build()
    );

    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "Message updated",
        withSender(context, toMessageResponseDto(response))
      )
    );
  }

  @DeleteMapping(
    value = "/tickets/{ticketId}/messages/{messageId}",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.TICKET_MESSAGE_MODERATE)
  public ResponseEntity<
    ApiResponse<MessageResponseDto>
  > messagesControllerRedactV1(
    @PathVariable("ticketId") String ticketId,
    @PathVariable("messageId") String messageId
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    RedactMessageResponse response = withMetadata(context).redactMessage(
      RedactMessageRequest.newBuilder()
        .setTicketId(ticketId)
        .setMessageId(messageId)
        .build()
    );

    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "Message redacted",
        withSender(context, toMessageResponseDto(response.getMessage()))
      )
    );
  }

  @PostMapping(
    value = "/tickets/{ticketId}/messages/attachments/upload-url",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "404" })
  public ResponseEntity<
    ApiResponse<PresignAttachmentResponseDto>
  > messagesControllerPresignNewAttachmentV1(
    @PathVariable("ticketId") String ticketId,
    @Valid @RequestBody UploadAttachmentDto uploadAttachmentDto
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    PresignAttachmentResponse response = withMetadata(context).uploadAttachment(
      UploadAttachmentRequest.newBuilder()
        .setTicketId(ticketId)
        .setFileName(uploadAttachmentDto.getFileName())
        .setFileSizeBytes(uploadAttachmentDto.getFileSizeBytes().longValue())
        .setMimeType(uploadAttachmentDto.getMimeType().getValue())
        .build()
    );

    return ResponseEntity.ok(
      ApiResponse.of(200, "OK", toPresignData(response))
    );
  }

  @PostMapping(
    value = "/tickets/{ticketId}/messages/{messageId}/attachments/upload-url",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "404" })
  public ResponseEntity<
    ApiResponse<PresignAttachmentResponseDto>
  > messagesControllerPresignAttachmentV1(
    @PathVariable("ticketId") String ticketId,
    @PathVariable("messageId") String messageId,
    @Valid @RequestBody UploadAttachmentDto uploadAttachmentDto
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    PresignAttachmentResponse response = withMetadata(context).uploadAttachment(
      UploadAttachmentRequest.newBuilder()
        .setTicketId(ticketId)
        .setMessageId(messageId)
        .setFileName(uploadAttachmentDto.getFileName())
        .setFileSizeBytes(uploadAttachmentDto.getFileSizeBytes().longValue())
        .setMimeType(uploadAttachmentDto.getMimeType().getValue())
        .build()
    );

    return ResponseEntity.ok(
      ApiResponse.of(200, "OK", toPresignData(response))
    );
  }

  @PostMapping(
    value = "/tickets/{ticketId}/messages/{messageId}/attachments/confirm",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "404" })
  @ResponseStatus(HttpStatus.CREATED)
  public ResponseEntity<
    ApiResponse<AttachmentResponseDto>
  > messagesControllerConfirmAttachmentV1(
    @PathVariable("ticketId") String ticketId,
    @PathVariable("messageId") String messageId,
    @Valid @RequestBody ConfirmAttachmentDto confirmAttachmentDto
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    AttachmentResponse response = withMetadata(context).confirmAttachment(
      ConfirmAttachmentRequest.newBuilder()
        .setTicketId(ticketId)
        .setMessageId(messageId)
        .setObjectPath(confirmAttachmentDto.getObjectPath())
        .setFileName(confirmAttachmentDto.getFileName())
        .build()
    );

    return ResponseEntity.status(HttpStatus.CREATED).body(
      ApiResponse.of(201, "Attachment added", TicketsCrudService.toAttachmentResponseDto(response))
    );
  }

  @GetMapping(
    value = "/tickets/{ticketId}/messages/{messageId}/attachments",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "404" })
  public ResponseEntity<
    ApiResponse<List<AttachmentResponseDto>>
  > messagesControllerListAttachmentsV1(
    @PathVariable("ticketId") String ticketId,
    @PathVariable("messageId") String messageId
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    var response = withMetadata(context).listAttachments(
      ListAttachmentsRequest.newBuilder()
        .setTicketId(ticketId)
        .setMessageId(messageId)
        .build()
    );

    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "OK",
        response
          .getItemsList()
          .stream()
          .map(TicketsCrudService::toAttachmentResponseDto)
          .toList()
      )
    );
  }

  static PresignAttachmentResponseDto toPresignData(
    PresignAttachmentResponse response
  ) {
    return new PresignAttachmentResponseDto(
      response.getUploadUrl(),
      UploadMethod.of(response.getUploadMethod()),
      response.getObjectPath(),
      toOffsetDateTime(response.getExpiresAt())
    );
  }

  private MessageResponseDto withSender(
    RequestContext context,
    MessageResponseDto message
  ) {
    references.fillMessages(context, List.of(message));
    return message;
  }

  private static MessageResponseDto toMessageResponseDto(
    MessageResponse message
  ) {
    return new MessageResponseDto(
      message.getId(),
      message.getTicketId(),
      message.hasSenderId() ? message.getSenderId() : null,
      message.getContent(),
      message.getIsAiGenerated(),
      message.getIsInternalNote(),
      message.hasModelName() ? message.getModelName() : null,
      message.hasPromptTokens()
        ? BigDecimal.valueOf(message.getPromptTokens())
        : null,
      message.hasCompletionTokens()
        ? BigDecimal.valueOf(message.getCompletionTokens())
        : null,
      message.hasEditedAt() ? toOffsetDateTime(message.getEditedAt()) : null,
      message.hasRedactedAt()
        ? toOffsetDateTime(message.getRedactedAt())
        : null,
      toOffsetDateTime(message.getCreatedAt()),
      message
        .getAttachmentsList()
        .stream()
        .map(TicketsCrudService::toAttachmentResponseDto)
        .toList(),
      message.getExcludedFromAiContext(),
      toAnswerStatusEnum(message.getAnswerStatus()),
      message.hasCitations()
        ? message
            .getCitations()
            .getItemsList()
            .stream()
            .map(MessagesController::toCitationResponseDto)
            .toList()
        : null
    ).editableUntil(
      message.hasEditableUntil()
        ? toOffsetDateTime(message.getEditableUntil())
        : null
    );
  }


  private static CitationResponseDto toCitationResponseDto(
    DraftCitation citation
  ) {
    return new CitationResponseDto(
      citation.getChunkId(),
      citation.getDocumentId(),
      citation.getDocumentTitle(),
      citation.hasPageNumber()
        ? BigDecimal.valueOf(citation.getPageNumber())
        : null,
      citation.getVectorPointId()
    );
  }

  private static MessageResponseDto.AnswerStatusEnum toAnswerStatusEnum(
    MessageAnswerStatus status
  ) {
    return switch (status) {
      case MESSAGE_ANSWER_STATUS_DOC_ANSWER -> MessageResponseDto.AnswerStatusEnum.DOC_ANSWER;
      case MESSAGE_ANSWER_STATUS_DOC_MISSING -> MessageResponseDto.AnswerStatusEnum.DOC_MISSING;
      case MESSAGE_ANSWER_STATUS_GREETING -> MessageResponseDto.AnswerStatusEnum.GREETING;
      case MESSAGE_ANSWER_STATUS_AT_CAP -> MessageResponseDto.AnswerStatusEnum.AT_CAP;
      case MESSAGE_ANSWER_STATUS_REFUSED -> MessageResponseDto.AnswerStatusEnum.REFUSED;
      default -> null;
    };
  }

  private static OffsetDateTime toOffsetDateTime(
    com.google.protobuf.Timestamp timestamp
  ) {
    return Instant.ofEpochSecond(
      timestamp.getSeconds(),
      timestamp.getNanos()
    ).atOffset(ZoneOffset.UTC);
  }

  private MessageServiceGrpc.MessageServiceBlockingStub withMetadata(
    RequestContext context
  ) {
    return stub
      .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
      .withInterceptors(
        MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context))
      );
  }
}
