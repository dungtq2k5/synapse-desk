package com.synapsedesk.gateway.attachments;

import com.synapsedesk.gateway.auth.CurrentRequest;
import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import com.synapsedesk.gateway.model.CurrentUserResponseDto.PermissionCodesEnum;
import com.synapsedesk.gateway.model.DownloadDocumentResponseDto;
import com.synapsedesk.gateway.openapi.ApiErrors;
import com.synapsedesk.gateway.security.RequirePermission;
import com.synapsedesk.gateway.web.ApiPaths;
import com.synapsedesk.gateway.web.ApiResponse;
import io.grpc.stub.MetadataUtils;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.concurrent.TimeUnit;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import synapsedesk.ticket.Message.DeleteAttachmentRequest;
import synapsedesk.ticket.Message.DownloadAttachmentRequest;
import synapsedesk.ticket.Message.DownloadAttachmentResponse;
import synapsedesk.ticket.MessageServiceGrpc;

/**
 * `AttachmentsApi` — a top-level prefix (not nested under tickets), against
 * ticket-service's `MessageService` on the EXISTING `ticketServiceChannel`
 * (`messageServiceStub`, already wired for `Chat`). No new gRPC infrastructure.
 *
 * <p>`remove` answers 204 with an empty body — `@ResponseStatus` is what tells
 * springdoc that; without it the document would claim 200.
 */
@Tag(name = "Attachments")
@RestController
@RequestMapping(ApiPaths.V1)
@Validated
public class AttachmentsController {

  private static final long DEADLINE_SECONDS = 5;

  private final MessageServiceGrpc.MessageServiceBlockingStub stub;
  private final CurrentUser currentUser;

  public AttachmentsController(
    MessageServiceGrpc.MessageServiceBlockingStub stub,
    CurrentUser currentUser
  ) {
    this.stub = stub;
    this.currentUser = currentUser;
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

  @GetMapping(
    value = "/attachments/{id}/download",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "404" })
  public ResponseEntity<
    ApiResponse<DownloadDocumentResponseDto>
  > attachmentsControllerDownloadV1(@PathVariable("id") String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    DownloadAttachmentResponse response = withMetadata(
      context
    ).downloadAttachment(
      DownloadAttachmentRequest.newBuilder().setAttachmentId(id).build()
    );

    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "OK",
        new DownloadDocumentResponseDto(
          response.getDownloadUrl(),
          toOffsetDateTime(response.getExpiresAt())
        )
      )
    );
  }

  @DeleteMapping(value = "/attachments/{id}", produces = { "application/json" })
  @ApiErrors({ "400", "401", "403", "404" })
  @ResponseStatus(HttpStatus.NO_CONTENT)
  @RequirePermission(PermissionCodesEnum.TICKET_MESSAGE_MODERATE)
  public ResponseEntity<ApiResponse<Void>> attachmentsControllerRemoveV1(
    @PathVariable("id") String id
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    withMetadata(context).deleteAttachment(
      DeleteAttachmentRequest.newBuilder().setAttachmentId(id).build()
    );

    return ResponseEntity.noContent().build();
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
