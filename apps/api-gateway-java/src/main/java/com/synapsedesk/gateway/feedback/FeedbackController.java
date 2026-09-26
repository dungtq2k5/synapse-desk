package com.synapsedesk.gateway.feedback;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.concurrent.TimeUnit;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import com.synapsedesk.gateway.auth.CurrentRequest;
import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.generated.api.FeedbackApi;
import com.synapsedesk.gateway.generated.model.AuthControllerForgotPasswordV1202Response;
import com.synapsedesk.gateway.generated.model.CurrentUserResponseDto.PermissionCodesEnum;
import com.synapsedesk.gateway.generated.model.FeedbackControllerListV1200Response;
import com.synapsedesk.gateway.generated.model.FeedbackControllerListV1200ResponseData;
import com.synapsedesk.gateway.generated.model.FeedbackResponseDto;
import com.synapsedesk.gateway.generated.model.InvitationsControllerListV1200ResponseDataMeta;
import com.synapsedesk.gateway.generated.model.MessageFeedbackControllerOwnV1200Response;
import com.synapsedesk.gateway.generated.model.SubmitFeedbackDto;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import com.synapsedesk.gateway.security.RequirePermission;

import io.grpc.stub.MetadataUtils;
import synapsedesk.auth.Common.PageMeta;
import synapsedesk.auth.Common.PageRequest;
import synapsedesk.auth.Common.SortOrder;
import synapsedesk.ticket.Feedback.FeedbackResponse;
import synapsedesk.ticket.Feedback.GetFeedbackRequest;
import synapsedesk.ticket.Feedback.ListFeedbackRequest;
import synapsedesk.ticket.Feedback.ListFeedbackResponse;
import synapsedesk.ticket.Feedback.SubmitFeedbackRequest;
import synapsedesk.ticket.Feedback.WithdrawFeedbackRequest;
import synapsedesk.ticket.FeedbackServiceGrpc;

/**
 * `FeedbackApi` — `MessageFeedbackController` and `FeedbackController` folded
 * into the one generated interface both share, against `ticket-service`'s
 * `FeedbackService`. The `Feedback` module pays for that channel
 * (`GrpcChannels.ticketServiceChannel`); `Chat` reuses it.
 *
 * <p><b>`withdraw` is a real 204 — no body.</b> A naive
 * {@code ResponseEntity.status(204).body(new AuthControllerForgotPasswordV1202Response())}
 * would serialize an envelope into a response the spec says has none, so this
 * builds the {@link ResponseEntity} with no body at all.
 */
@RestController
public class FeedbackController implements FeedbackApi {

  private static final long DEADLINE_SECONDS = 5;

  private final FeedbackServiceGrpc.FeedbackServiceBlockingStub stub;
  private final CurrentUser currentUser;

  public FeedbackController(FeedbackServiceGrpc.FeedbackServiceBlockingStub stub, CurrentUser currentUser) {
    this.stub = stub;
    this.currentUser = currentUser;
  }

  private FeedbackServiceGrpc.FeedbackServiceBlockingStub withMetadata(RequestContext context) {
    return stub.withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
        .withInterceptors(MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context)));
  }

  @Override
  public ResponseEntity<MessageFeedbackControllerOwnV1200Response> messageFeedbackControllerSubmitV1(
      String messageId, SubmitFeedbackDto submitFeedbackDto) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    SubmitFeedbackRequest.Builder wire =
        SubmitFeedbackRequest.newBuilder()
            .setTicketMessageId(messageId)
            .setRating(submitFeedbackDto.getRating().getValue().intValue());
    if (submitFeedbackDto.getFeedbackText() != null) {
      wire.setFeedbackText(submitFeedbackDto.getFeedbackText());
    }
    if (submitFeedbackDto.getCitationAccurate() != null) {
      wire.setCitationAccurate(submitFeedbackDto.getCitationAccurate());
    }

    FeedbackResponse response = withMetadata(context).submitFeedback(wire.build());

    return ResponseEntity.ok(
        new MessageFeedbackControllerOwnV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("Feedback recorded")
            .data(toDto(response)));
  }

  @Override
  public ResponseEntity<MessageFeedbackControllerOwnV1200Response> messageFeedbackControllerOwnV1(
      String messageId) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    var response =
        withMetadata(context)
            .getFeedback(GetFeedbackRequest.newBuilder().setTicketMessageId(messageId).build());

    FeedbackResponseDto data = response.hasFeedback() ? toDto(response.getFeedback()) : null;

    return ResponseEntity.ok(
        new MessageFeedbackControllerOwnV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(data));
  }

  @Override
  public ResponseEntity<AuthControllerForgotPasswordV1202Response> messageFeedbackControllerWithdrawV1(
      String messageId) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    withMetadata(context)
        .withdrawFeedback(WithdrawFeedbackRequest.newBuilder().setTicketMessageId(messageId).build());

    return ResponseEntity.status(HttpStatus.NO_CONTENT).build();
  }

  @Override
  @RequirePermission(PermissionCodesEnum.ANALYTICS_READ)
  public ResponseEntity<FeedbackControllerListV1200Response> feedbackControllerListV1(
      BigDecimal page,
      BigDecimal limit,
      String sortBy,
      String sortOrder,
      String searchTerm,
      Boolean citationAccurate,
      OffsetDateTime from,
      OffsetDateTime to) {
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

    ListFeedbackRequest.Builder wire = ListFeedbackRequest.newBuilder().setPage(pageRequest);
    if (citationAccurate != null) {
      wire.setCitationAccurate(citationAccurate);
    }
    if (from != null) {
      wire.setFrom(toTimestamp(from));
    }
    if (to != null) {
      wire.setTo(toTimestamp(to));
    }

    ListFeedbackResponse response = withMetadata(context).listFeedback(wire.build());

    FeedbackControllerListV1200ResponseData data =
        new FeedbackControllerListV1200ResponseData()
            .items(response.getItemsList().stream().map(FeedbackController::toDto).toList())
            .meta(toMetaDto(response.getMeta()));

    return ResponseEntity.ok(
        new FeedbackControllerListV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(data));
  }

  private static FeedbackResponseDto toDto(FeedbackResponse feedback) {
    return new FeedbackResponseDto(
        FeedbackResponseDto.RatingEnum.fromValue(BigDecimal.valueOf(feedback.getRating())),
        feedback.getId(),
        feedback.getTicketMessageId(),
        feedback.getUserId(),
        feedback.getOrganizationId(),
        feedback.hasFeedbackText() ? feedback.getFeedbackText() : null,
        feedback.hasCitationAccurate() ? feedback.getCitationAccurate() : null,
        toOffsetDateTime(feedback.getCreatedAt()),
        toOffsetDateTime(feedback.getUpdatedAt()));
  }

  private static InvitationsControllerListV1200ResponseDataMeta toMetaDto(PageMeta meta) {
    return new InvitationsControllerListV1200ResponseDataMeta(
        BigDecimal.valueOf(meta.getTotalItems()),
        BigDecimal.valueOf(meta.getItemCount()),
        BigDecimal.valueOf(meta.getItemsPerPage()),
        BigDecimal.valueOf(meta.getTotalPages()),
        BigDecimal.valueOf(meta.getCurrentPage()));
  }

  private static OffsetDateTime toOffsetDateTime(com.google.protobuf.Timestamp timestamp) {
    return Instant.ofEpochSecond(timestamp.getSeconds(), timestamp.getNanos()).atOffset(ZoneOffset.UTC);
  }

  private static com.google.protobuf.Timestamp toTimestamp(OffsetDateTime value) {
    Instant instant = value.toInstant();
    return com.google.protobuf.Timestamp.newBuilder()
        .setSeconds(instant.getEpochSecond())
        .setNanos(instant.getNano())
        .build();
  }
}
