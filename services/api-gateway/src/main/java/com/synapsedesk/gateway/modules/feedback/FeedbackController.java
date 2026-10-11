package com.synapsedesk.gateway.modules.feedback;

import com.synapsedesk.gateway.common.auth.CurrentRequest;
import com.synapsedesk.gateway.common.auth.CurrentUser;
import com.synapsedesk.gateway.common.auth.RequestContext;
import com.synapsedesk.gateway.common.grpc.CallerMetadata;
import com.synapsedesk.gateway.common.openapi.ApiErrors;
import com.synapsedesk.gateway.common.security.RequirePermission;
import com.synapsedesk.gateway.common.web.ApiPaths;
import com.synapsedesk.gateway.common.web.ApiResponse;
import com.synapsedesk.gateway.common.web.PageMeta;
import com.synapsedesk.gateway.common.web.PagedData;
import com.synapsedesk.gateway.common.web.SortDirection;
import com.synapsedesk.gateway.model.CurrentUserResponseDto.PermissionCodesEnum;
import com.synapsedesk.gateway.model.FeedbackResponseDto;
import com.synapsedesk.gateway.model.SubmitFeedbackDto;
import io.grpc.stub.MetadataUtils;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.concurrent.TimeUnit;
import org.jspecify.annotations.Nullable;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
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
 * <p><b>`withdraw` is a real 204 — no body.</b> `@ResponseStatus` is what
 * tells springdoc that; without it the document would claim 200.
 *
 * <p><b>Migrated off `FeedbackApi`.</b>
 */
@Tag(name = "Feedback")
@RestController
@RequestMapping(ApiPaths.V1)
@Validated
public class FeedbackController {

  private static final long DEADLINE_SECONDS = 5;

  private final FeedbackServiceGrpc.FeedbackServiceBlockingStub stub;
  private final CurrentUser currentUser;

  public FeedbackController(
    FeedbackServiceGrpc.FeedbackServiceBlockingStub stub,
    CurrentUser currentUser
  ) {
    this.stub = stub;
    this.currentUser = currentUser;
  }

  private FeedbackServiceGrpc.FeedbackServiceBlockingStub withMetadata(
    RequestContext context
  ) {
    return stub
      .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
      .withInterceptors(
        MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context))
      );
  }

  @PostMapping(
    value = "/messages/{messageId}/feedback",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "404" })
  public ResponseEntity<
    ApiResponse<FeedbackResponseDto>
  > messageFeedbackControllerSubmitV1(
    @PathVariable("messageId") String messageId,
    @Valid @RequestBody SubmitFeedbackDto submitFeedbackDto
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    SubmitFeedbackRequest.Builder wire = SubmitFeedbackRequest.newBuilder()
      .setTicketMessageId(messageId)
      .setRating(submitFeedbackDto.getRating().getValue().intValue());
    if (submitFeedbackDto.getFeedbackText() != null) {
      wire.setFeedbackText(submitFeedbackDto.getFeedbackText());
    }
    if (submitFeedbackDto.getCitationAccurate() != null) {
      wire.setCitationAccurate(submitFeedbackDto.getCitationAccurate());
    }

    FeedbackResponse response = withMetadata(context).submitFeedback(
      wire.build()
    );

    return ResponseEntity.ok(
      ApiResponse.of(200, "Feedback recorded", toDto(response))
    );
  }

  @GetMapping(
    value = "/messages/{messageId}/feedback",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "404" })
  public ResponseEntity<
    ApiResponse<FeedbackResponseDto>
  > messageFeedbackControllerOwnV1(
    @PathVariable("messageId") String messageId
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    var response = withMetadata(context).getFeedback(
      GetFeedbackRequest.newBuilder().setTicketMessageId(messageId).build()
    );

    FeedbackResponseDto data = response.hasFeedback()
      ? toDto(response.getFeedback())
      : null;

    return ResponseEntity.ok(ApiResponse.of(200, "OK", data));
  }

  @DeleteMapping(
    value = "/messages/{messageId}/feedback",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "404" })
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public ResponseEntity<Void> messageFeedbackControllerWithdrawV1(
    @PathVariable("messageId") String messageId
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    withMetadata(context).withdrawFeedback(
      WithdrawFeedbackRequest.newBuilder().setTicketMessageId(messageId).build()
    );

    return ResponseEntity.status(HttpStatus.NO_CONTENT).build();
  }

  @GetMapping(value = "/feedback", produces = { "application/json" })
  @ApiErrors({ "401", "403" })
  @RequirePermission(PermissionCodesEnum.ANALYTICS_READ)
  public ResponseEntity<
    ApiResponse<PagedData<FeedbackResponseDto>>
  > feedbackControllerListV1(
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
    ) @Nullable String searchTerm,
    @Valid @RequestParam(
      value = "citationAccurate",
      required = false
    ) @Nullable Boolean citationAccurate,
    @Valid @RequestParam(value = "from", required = false) @DateTimeFormat(
      iso = DateTimeFormat.ISO.DATE_TIME
    ) @Nullable OffsetDateTime from,
    @Valid @RequestParam(value = "to", required = false) @DateTimeFormat(
      iso = DateTimeFormat.ISO.DATE_TIME
    ) @Nullable OffsetDateTime to
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

    ListFeedbackRequest.Builder wire = ListFeedbackRequest.newBuilder().setPage(
      pageRequest
    );
    if (citationAccurate != null) {
      wire.setCitationAccurate(citationAccurate);
    }
    if (from != null) {
      wire.setFrom(toTimestamp(from));
    }
    if (to != null) {
      wire.setTo(toTimestamp(to));
    }

    ListFeedbackResponse response = withMetadata(context).listFeedback(
      wire.build()
    );

    PagedData<FeedbackResponseDto> data = new PagedData<>(
      response.getItemsList().stream().map(FeedbackController::toDto).toList(),
      PageMeta.from(response.getMeta())
    );

    return ResponseEntity.ok(ApiResponse.of(200, "OK", data));
  }

  private static FeedbackResponseDto toDto(FeedbackResponse feedback) {
    return new FeedbackResponseDto(
      SubmitFeedbackDto.RatingEnum.fromValue(
        BigDecimal.valueOf(feedback.getRating())
      ),
      feedback.getId(),
      feedback.getTicketMessageId(),
      feedback.getUserId(),
      feedback.getOrganizationId(),
      feedback.hasFeedbackText() ? feedback.getFeedbackText() : null,
      feedback.hasCitationAccurate() ? feedback.getCitationAccurate() : null,
      toOffsetDateTime(feedback.getCreatedAt()),
      toOffsetDateTime(feedback.getUpdatedAt())
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

  private static com.google.protobuf.Timestamp toTimestamp(
    OffsetDateTime value
  ) {
    Instant instant = value.toInstant();
    return com.google.protobuf.Timestamp.newBuilder()
      .setSeconds(instant.getEpochSecond())
      .setNanos(instant.getNano())
      .build();
  }
}
