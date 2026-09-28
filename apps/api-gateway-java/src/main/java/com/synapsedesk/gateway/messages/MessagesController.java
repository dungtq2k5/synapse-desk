package com.synapsedesk.gateway.messages;

import com.synapsedesk.gateway.auth.CurrentRequest;
import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.generated.api.MessagesApi;
import com.synapsedesk.gateway.generated.model.AttachmentResponseDto;
import com.synapsedesk.gateway.generated.model.AuthControllerForgotPasswordV1202Response;
import com.synapsedesk.gateway.generated.model.CitationResponseDto;
import com.synapsedesk.gateway.generated.model.ConfirmAttachmentDto;
import com.synapsedesk.gateway.generated.model.CreateMessageDto;
import com.synapsedesk.gateway.generated.model.CreateMessageResponseDto;
import com.synapsedesk.gateway.generated.model.CurrentUserResponseDto.PermissionCodesEnum;
import com.synapsedesk.gateway.generated.model.InvitationsControllerListV1200ResponseDataMeta;
import com.synapsedesk.gateway.generated.model.MessageResponseDto;
import com.synapsedesk.gateway.generated.model.MessagesControllerConfirmAttachmentV1201Response;
import com.synapsedesk.gateway.generated.model.MessagesControllerCreateV1201Response;
import com.synapsedesk.gateway.generated.model.MessagesControllerListAttachmentsV1200Response;
import com.synapsedesk.gateway.generated.model.MessagesControllerListV1200Response;
import com.synapsedesk.gateway.generated.model.MessagesControllerListV1200ResponseData;
import com.synapsedesk.gateway.generated.model.MessagesControllerRedactV1200Response;
import com.synapsedesk.gateway.generated.model.UpdateMessageDto;
import com.synapsedesk.gateway.generated.model.UploadAttachmentDto;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import com.synapsedesk.gateway.security.RequirePermission;
import io.grpc.stub.MetadataUtils;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;
import synapsedesk.auth.Common.PageRequest;
import synapsedesk.auth.Common.SortOrder;
import synapsedesk.ticket.Ai.DraftCitation;
import synapsedesk.ticket.Message.AttachmentResponse;
import synapsedesk.ticket.Message.ConfirmAttachmentRequest;
import synapsedesk.ticket.Message.CreateMessageRequest;
import synapsedesk.ticket.Message.CreateMessageResponse;
import synapsedesk.ticket.Message.ListAttachmentsRequest;
import synapsedesk.ticket.Message.ListMessagesRequest;
import synapsedesk.ticket.Message.ListMessagesResponse;
import synapsedesk.ticket.Message.MessageAnswerStatus;
import synapsedesk.ticket.Message.MessageResponse;
import synapsedesk.ticket.Message.NewAttachment;
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
 * Node's own reasoning, reproduced exactly: the thread is how an end user
 * talks to support, so gating reads or replies would make the product's core
 * interaction staff-only. What is restricted lives one layer down, decided
 * PER ROW rather than per route (internal notes stripped in ticket-service's
 * own query for a non-agent; edit ownership and the edit window enforced
 * there too). <b>Only {@code redact} carries a route permission</b>
 * ({@code ticket.message.moderate}) — the one action that is purely
 * moderation. Every other method below carries no {@code @RequirePermission}
 * at all, and none should ever gain one without the same reasoning Node's
 * controller docblock states.
 *
 * <p>
 * The two presign routes reuse the generic empty-data envelope
 * ({@code AuthControllerForgotPasswordV1202Response}) because no
 * {@code PresignAttachmentResponseDto} model type was generated for
 * {@code {uploadUrl, objectPath, expiresAt}} — a generator artifact, not a
 * real coupling to auth. The shape is built as a plain map, keyed exactly as
 * the Node DTO's fields.
 */
@RestController
public class MessagesController implements MessagesApi {

  private static final long DEADLINE_SECONDS = 5;

  private final MessageServiceGrpc.MessageServiceBlockingStub stub;
  private final CurrentUser currentUser;

  public MessagesController(
    MessageServiceGrpc.MessageServiceBlockingStub stub,
    CurrentUser currentUser
  ) {
    this.stub = stub;
    this.currentUser = currentUser;
  }

  @Override
  public ResponseEntity<MessagesControllerListV1200Response> messagesControllerListV1(
    String ticketId,
    BigDecimal page,
    BigDecimal limit,
    String sortBy,
    String sortOrder,
    String searchTerm
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    PageRequest.Builder pageRequest = PageRequest.newBuilder()
      .setPage(page.intValue())
      .setLimit(limit.intValue())
      .setSortBy(sortBy)
      .setSortOrder(
        "DESC".equalsIgnoreCase(sortOrder)
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

    MessagesControllerListV1200ResponseData data =
      new MessagesControllerListV1200ResponseData(
        response
          .getItemsList()
          .stream()
          .map(MessagesController::toMessageResponseDto)
          .toList(),
        toMetaDto(response.getMeta())
      );

    return ResponseEntity.ok(
      new MessagesControllerListV1200Response()
        .success(true)
        .statusCode(BigDecimal.valueOf(200))
        .message("OK")
        .data(data)
    );
  }

  @Override
  public ResponseEntity<MessagesControllerCreateV1201Response> messagesControllerCreateV1(
    String ticketId,
    CreateMessageDto createMessageDto
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
    if (createMessageDto.getGeneratedFromId() != null) {
      wire.setGeneratedFromId(createMessageDto.getGeneratedFromId().toString());
    }

    CreateMessageResponse response = withMetadata(context).createMessage(
      wire.build()
    );

    CreateMessageResponseDto data = new CreateMessageResponseDto(
      toMessageResponseDto(response.getMessage()),
      response.getSkippedAttachmentsList()
    );

    return ResponseEntity.status(HttpStatus.CREATED).body(
      new MessagesControllerCreateV1201Response()
        .success(true)
        .statusCode(BigDecimal.valueOf(201))
        .message("Message posted")
        .data(data)
    );
  }

  @Override
  public ResponseEntity<MessagesControllerRedactV1200Response> messagesControllerUpdateV1(
    String ticketId,
    String messageId,
    UpdateMessageDto updateMessageDto
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
      new MessagesControllerRedactV1200Response()
        .success(true)
        .statusCode(BigDecimal.valueOf(200))
        .message("Message updated")
        .data(toMessageResponseDto(response))
    );
  }

  @Override
  @RequirePermission(PermissionCodesEnum.TICKET_MESSAGE_MODERATE)
  public ResponseEntity<MessagesControllerRedactV1200Response> messagesControllerRedactV1(
    String ticketId,
    String messageId
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    RedactMessageResponse response = withMetadata(context).redactMessage(
      RedactMessageRequest.newBuilder()
        .setTicketId(ticketId)
        .setMessageId(messageId)
        .build()
    );

    return ResponseEntity.ok(
      new MessagesControllerRedactV1200Response()
        .success(true)
        .statusCode(BigDecimal.valueOf(200))
        .message("Message redacted")
        .data(toMessageResponseDto(response.getMessage()))
    );
  }

  @Override
  public ResponseEntity<AuthControllerForgotPasswordV1202Response> messagesControllerPresignNewAttachmentV1(
    String ticketId,
    UploadAttachmentDto uploadAttachmentDto
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
      new AuthControllerForgotPasswordV1202Response()
        .success(true)
        .statusCode(BigDecimal.valueOf(200))
        .message("OK")
        .data(toPresignData(response))
    );
  }

  @Override
  public ResponseEntity<AuthControllerForgotPasswordV1202Response> messagesControllerPresignAttachmentV1(
    String ticketId,
    String messageId,
    UploadAttachmentDto uploadAttachmentDto
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
      new AuthControllerForgotPasswordV1202Response()
        .success(true)
        .statusCode(BigDecimal.valueOf(200))
        .message("OK")
        .data(toPresignData(response))
    );
  }

  @Override
  public ResponseEntity<MessagesControllerConfirmAttachmentV1201Response> messagesControllerConfirmAttachmentV1(
    String ticketId,
    String messageId,
    ConfirmAttachmentDto confirmAttachmentDto
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
      new MessagesControllerConfirmAttachmentV1201Response()
        .success(true)
        .statusCode(BigDecimal.valueOf(201))
        .message("Attachment added")
        .data(toAttachmentResponseDto(response))
    );
  }

  @Override
  public ResponseEntity<MessagesControllerListAttachmentsV1200Response> messagesControllerListAttachmentsV1(
    String ticketId,
    String messageId
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    var response = withMetadata(context).listAttachments(
      ListAttachmentsRequest.newBuilder()
        .setTicketId(ticketId)
        .setMessageId(messageId)
        .build()
    );

    return ResponseEntity.ok(
      new MessagesControllerListAttachmentsV1200Response()
        .success(true)
        .statusCode(BigDecimal.valueOf(200))
        .message("OK")
        .data(
          response
            .getItemsList()
            .stream()
            .map(MessagesController::toAttachmentResponseDto)
            .toList()
        )
    );
  }

  private static Map<String, Object> toPresignData(
    PresignAttachmentResponse response
  ) {
    Map<String, Object> data = new LinkedHashMap<>();
    data.put("uploadUrl", response.getUploadUrl());
    data.put("objectPath", response.getObjectPath());
    data.put("expiresAt", toOffsetDateTime(response.getExpiresAt()));
    return data;
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
        .map(MessagesController::toAttachmentResponseDto)
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
    );
  }

  private static AttachmentResponseDto toAttachmentResponseDto(
    AttachmentResponse attachment
  ) {
    return new AttachmentResponseDto(
      attachment.getId(),
      attachment.getMessageId(),
      attachment.getFileName(),
      attachment.getFileUrl(),
      BigDecimal.valueOf(attachment.getFileSizeBytes()),
      attachment.getMimeType(),
      toOffsetDateTime(attachment.getCreatedAt())
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

  private static InvitationsControllerListV1200ResponseDataMeta toMetaDto(
    synapsedesk.auth.Common.PageMeta meta
  ) {
    return new InvitationsControllerListV1200ResponseDataMeta(
      BigDecimal.valueOf(meta.getTotalItems()),
      BigDecimal.valueOf(meta.getItemCount()),
      BigDecimal.valueOf(meta.getItemsPerPage()),
      BigDecimal.valueOf(meta.getTotalPages()),
      BigDecimal.valueOf(meta.getCurrentPage())
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
