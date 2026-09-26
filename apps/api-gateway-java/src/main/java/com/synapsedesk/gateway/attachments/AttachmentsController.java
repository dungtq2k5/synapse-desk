package com.synapsedesk.gateway.attachments;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.concurrent.TimeUnit;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import com.synapsedesk.gateway.auth.CurrentRequest;
import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.generated.api.AttachmentsApi;
import com.synapsedesk.gateway.generated.model.AuthControllerForgotPasswordV1202Response;
import com.synapsedesk.gateway.generated.model.CurrentUserResponseDto.PermissionCodesEnum;
import com.synapsedesk.gateway.generated.model.DownloadDocumentResponseDto;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import com.synapsedesk.gateway.security.RequirePermission;

import io.grpc.stub.MetadataUtils;
import synapsedesk.ticket.Message.DeleteAttachmentRequest;
import synapsedesk.ticket.Message.DownloadAttachmentRequest;
import synapsedesk.ticket.Message.DownloadAttachmentResponse;
import synapsedesk.ticket.MessageServiceGrpc;

/**
 * `AttachmentsApi` — a top-level prefix (not nested under tickets), against
 * ticket-service's `MessageService` on the EXISTING `ticketServiceChannel`
 * (`messageServiceStub`, already wired for `Chat`). No new gRPC infrastructure.
 *
 * <p>`download`'s generated envelope is the fully generic
 * {@code AuthControllerForgotPasswordV1202Response} (no typed model exists for
 * this route's body) — the payload shape is the same {@code
 * {downloadUrl, expiresAt}} every other download route in this gateway uses,
 * so `DownloadDocumentResponseDto` is reused here for its shape, not its name.
 */
@RestController
public class AttachmentsController implements AttachmentsApi {

  private static final long DEADLINE_SECONDS = 5;

  private final MessageServiceGrpc.MessageServiceBlockingStub stub;
  private final CurrentUser currentUser;

  public AttachmentsController(MessageServiceGrpc.MessageServiceBlockingStub stub, CurrentUser currentUser) {
    this.stub = stub;
    this.currentUser = currentUser;
  }

  private MessageServiceGrpc.MessageServiceBlockingStub withMetadata(RequestContext context) {
    return stub.withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
        .withInterceptors(MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context)));
  }

  @Override
  public ResponseEntity<AuthControllerForgotPasswordV1202Response> attachmentsControllerDownloadV1(String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    DownloadAttachmentResponse response =
        withMetadata(context)
            .downloadAttachment(DownloadAttachmentRequest.newBuilder().setAttachmentId(id).build());

    return ResponseEntity.ok(
        new AuthControllerForgotPasswordV1202Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(
                new DownloadDocumentResponseDto(
                    response.getDownloadUrl(), toOffsetDateTime(response.getExpiresAt()))));
  }

  @Override
  @RequirePermission(PermissionCodesEnum.TICKET_MESSAGE_MODERATE)
  public ResponseEntity<AuthControllerForgotPasswordV1202Response> attachmentsControllerRemoveV1(String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    withMetadata(context).deleteAttachment(DeleteAttachmentRequest.newBuilder().setAttachmentId(id).build());

    return ResponseEntity.noContent().build();
  }

  private static OffsetDateTime toOffsetDateTime(com.google.protobuf.Timestamp timestamp) {
    return Instant.ofEpochSecond(timestamp.getSeconds(), timestamp.getNanos()).atOffset(ZoneOffset.UTC);
  }
}
