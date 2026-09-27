package com.synapsedesk.gateway.ai;

import com.synapsedesk.gateway.auth.CurrentRequest;
import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.generated.api.AiApi;
import com.synapsedesk.gateway.generated.model.AiClassificationResponseDto;
import com.synapsedesk.gateway.generated.model.AiControllerClassifyV1200Response;
import com.synapsedesk.gateway.generated.model.AiControllerGenerateDraftV1200Response;
import com.synapsedesk.gateway.generated.model.AiControllerGetSuggestionsV1200Response;
import com.synapsedesk.gateway.generated.model.AiControllerGetSummaryV1200Response;
import com.synapsedesk.gateway.generated.model.AiDraftResponseDto;
import com.synapsedesk.gateway.generated.model.AiSuggestionResponseDto;
import com.synapsedesk.gateway.generated.model.AiSuggestionsResponseDto;
import com.synapsedesk.gateway.generated.model.AiSummaryResponseDto;
import com.synapsedesk.gateway.generated.model.CurrentUserResponseDto.PermissionCodesEnum;
import com.synapsedesk.gateway.generated.model.DraftCitationResponseDto;
import com.synapsedesk.gateway.generated.model.GenerateDraftDto;
import com.synapsedesk.gateway.generated.model.SuggestedArticleResponseDto;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import com.synapsedesk.gateway.security.RequirePermission;
import io.grpc.stub.MetadataUtils;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.concurrent.TimeUnit;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;
import synapsedesk.ticket.Ai.AiSummaryResponse;
import synapsedesk.ticket.Ai.ClassifyTicketResponse;
import synapsedesk.ticket.Ai.DraftCitation;
import synapsedesk.ticket.Ai.GenerateDraftRequest;
import synapsedesk.ticket.Ai.GenerateDraftResponse;
import synapsedesk.ticket.Ai.GetSuggestionsResponse;
import synapsedesk.ticket.Ai.SuggestedArticleResponse;
import synapsedesk.ticket.Ai.SuggestionResponse;
import synapsedesk.ticket.Ai.SuggestionsDegradation;
import synapsedesk.ticket.Ai.TicketAiRequest;
import synapsedesk.ticket.AiServiceGrpc;
import synapsedesk.ticket.Common.TicketPriority;

/**
 * `AiApi` — the AI co-pilot surface, against ticket-service's `AiService`.
 * `GET /tickets/{id}/similar` is a DIFFERENT tag (`TicketsApi`, gated on
 * `ticket.read.all` rather than `ticket.ai.use` — it discloses other
 * people's ticket titles) and is out of scope here.
 *
 * <p>
 * Every route is a single unary passthrough — no caching, no multi-peer
 * composition, no gateway-side degrade logic. `getSuggestions` answering
 * with {@code degraded: LEXICAL_ONLY} instead of a billing 402 is entirely
 * ticket-service's own decision, forwarded as-is; the gateway does not
 * branch on it. The billing 402 the other three writes can answer arrives
 * as a gRPC `PERMISSION_DENIED` carrying a {@code [http:402]} marker, which
 * {@link com.synapsedesk.gateway.error.GrpcStatusMapping} already resolves
 * generically — no route-specific handling needed here.
 */
@RestController
public class AiController implements AiApi {

  private static final long DEADLINE_SECONDS = 5;

  private final AiServiceGrpc.AiServiceBlockingStub stub;
  private final CurrentUser currentUser;

  public AiController(AiServiceGrpc.AiServiceBlockingStub stub, CurrentUser currentUser) {
    this.stub = stub;
    this.currentUser = currentUser;
  }

  @Override
  @RequirePermission(PermissionCodesEnum.TICKET_READ_ALL)
  public ResponseEntity<AiControllerGetSummaryV1200Response> aiControllerGetSummaryV1(String ticketId) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    AiSummaryResponse response =
        withMetadata(context).getSummary(TicketAiRequest.newBuilder().setTicketId(ticketId).build());

    return ResponseEntity.ok(
        new AiControllerGetSummaryV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(toAiSummaryResponseDto(response)));
  }

  @Override
  @RequirePermission(PermissionCodesEnum.TICKET_AI_USE)
  public ResponseEntity<AiControllerGetSummaryV1200Response> aiControllerGenerateSummaryV1(String ticketId) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    AiSummaryResponse response =
        withMetadata(context).generateSummary(TicketAiRequest.newBuilder().setTicketId(ticketId).build());

    return ResponseEntity.ok(
        new AiControllerGetSummaryV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(toAiSummaryResponseDto(response)));
  }

  @Override
  @RequirePermission(PermissionCodesEnum.TICKET_AI_USE)
  public ResponseEntity<AiControllerGenerateDraftV1200Response> aiControllerGenerateDraftV1(
      String ticketId, GenerateDraftDto generateDraftDto) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    GenerateDraftRequest.Builder wire = GenerateDraftRequest.newBuilder().setTicketId(ticketId);
    if (generateDraftDto.getInstruction() != null) {
      wire.setInstruction(generateDraftDto.getInstruction());
    }

    GenerateDraftResponse response = withMetadata(context).generateDraft(wire.build());

    AiDraftResponseDto data =
        new AiDraftResponseDto(
            response.getContent(),
            response.getModelName(),
            BigDecimal.valueOf(response.getPromptTokens()),
            BigDecimal.valueOf(response.getCompletionTokens()),
            response.getGenerationId(),
            response.getCitationsList().stream().map(AiController::toDraftCitationResponseDto).toList());

    return ResponseEntity.ok(
        new AiControllerGenerateDraftV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(data));
  }

  @Override
  @RequirePermission(PermissionCodesEnum.TICKET_AI_USE)
  public ResponseEntity<AiControllerGetSuggestionsV1200Response> aiControllerGetSuggestionsV1(String ticketId) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    GetSuggestionsResponse response =
        withMetadata(context).getSuggestions(TicketAiRequest.newBuilder().setTicketId(ticketId).build());

    AiSuggestionsResponseDto data =
        new AiSuggestionsResponseDto(
            response.getItemsList().stream().map(AiController::toAiSuggestionResponseDto).toList(),
            response.getArticlesList().stream().map(AiController::toSuggestedArticleResponseDto).toList(),
            toDegradedEnum(response.getDegraded()));

    return ResponseEntity.ok(
        new AiControllerGetSuggestionsV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(data));
  }

  @Override
  @RequirePermission(PermissionCodesEnum.TICKET_AI_USE)
  public ResponseEntity<AiControllerClassifyV1200Response> aiControllerClassifyV1(String ticketId) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    ClassifyTicketResponse response =
        withMetadata(context).classifyTicket(TicketAiRequest.newBuilder().setTicketId(ticketId).build());

    AiClassificationResponseDto data =
        new AiClassificationResponseDto(
            response.getSuggestedDepartmentId(),
            toSuggestedPriorityEnum(response.getSuggestedPriority()),
            BigDecimal.valueOf(response.getConfidenceScore()));

    return ResponseEntity.ok(
        new AiControllerClassifyV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(data));
  }

  private static AiSummaryResponseDto toAiSummaryResponseDto(AiSummaryResponse summary) {
    return new AiSummaryResponseDto(
        summary.getId(),
        summary.getTicketId(),
        summary.getSummaryText(),
        summary.getSuggestedAction(),
        BigDecimal.valueOf(summary.getConfidenceScore()),
        summary.getModelName(),
        toOffsetDateTime(summary.getCreatedAt()),
        toOffsetDateTime(summary.getUpdatedAt()));
  }

  private static DraftCitationResponseDto toDraftCitationResponseDto(DraftCitation citation) {
    return new DraftCitationResponseDto(
        citation.getChunkId(),
        citation.getDocumentId(),
        citation.getDocumentTitle(),
        citation.hasPageNumber() ? BigDecimal.valueOf(citation.getPageNumber()) : null);
  }

  private static AiSuggestionResponseDto toAiSuggestionResponseDto(SuggestionResponse item) {
    return new AiSuggestionResponseDto(item.getTitle(), item.getBody(), BigDecimal.valueOf(item.getConfidenceScore()));
  }

  private static SuggestedArticleResponseDto toSuggestedArticleResponseDto(SuggestedArticleResponse article) {
    return new SuggestedArticleResponseDto(
        article.getDocumentId(),
        article.getDocumentTitle(),
        article.hasPageNumber() ? BigDecimal.valueOf(article.getPageNumber()) : null,
        BigDecimal.valueOf(article.getScore()));
  }

  private static AiSuggestionsResponseDto.DegradedEnum toDegradedEnum(SuggestionsDegradation degradation) {
    return switch (degradation) {
      case SUGGESTIONS_DEGRADATION_LEXICAL_ONLY -> AiSuggestionsResponseDto.DegradedEnum.LEXICAL_ONLY;
      default -> null;
    };
  }

  /** `TICKET_PRIORITY_HIGH` -> `HIGH`; `UNSPECIFIED`/anything unrecognized -> `null`. */
  private static AiClassificationResponseDto.SuggestedPriorityEnum toSuggestedPriorityEnum(TicketPriority priority) {
    return switch (priority) {
      case TICKET_PRIORITY_LOW -> AiClassificationResponseDto.SuggestedPriorityEnum.LOW;
      case TICKET_PRIORITY_MEDIUM -> AiClassificationResponseDto.SuggestedPriorityEnum.MEDIUM;
      case TICKET_PRIORITY_HIGH -> AiClassificationResponseDto.SuggestedPriorityEnum.HIGH;
      case TICKET_PRIORITY_URGENT -> AiClassificationResponseDto.SuggestedPriorityEnum.URGENT;
      default -> null;
    };
  }

  private static OffsetDateTime toOffsetDateTime(com.google.protobuf.Timestamp timestamp) {
    return Instant.ofEpochSecond(timestamp.getSeconds(), timestamp.getNanos()).atOffset(ZoneOffset.UTC);
  }

  private AiServiceGrpc.AiServiceBlockingStub withMetadata(RequestContext context) {
    return stub
        .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
        .withInterceptors(MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context)));
  }
}
