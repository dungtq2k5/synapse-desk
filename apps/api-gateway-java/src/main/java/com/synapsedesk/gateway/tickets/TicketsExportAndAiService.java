package com.synapsedesk.gateway.tickets;

import com.synapsedesk.gateway.auth.IsoDateCheck;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.generated.model.CreateTicketExportDto;
import com.synapsedesk.gateway.generated.model.CurrentUserResponseDto.PermissionCodesEnum;
import com.synapsedesk.gateway.generated.model.ExportResponseDto;
import com.synapsedesk.gateway.generated.model.SimilarTicketResponseDto;
import com.synapsedesk.gateway.generated.model.TicketsControllerCreateExportV1202Response;
import com.synapsedesk.gateway.generated.model.TicketsControllerListSimilarV1200Response;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import io.grpc.stub.MetadataUtils;
import java.math.BigDecimal;
import java.util.concurrent.TimeUnit;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import synapsedesk.ticket.Ai.ListSimilarTicketsResponse;
import synapsedesk.ticket.Ai.SimilarTicketResponse;
import synapsedesk.ticket.Ai.TicketAiRequest;
import synapsedesk.ticket.AiServiceGrpc;
import synapsedesk.ticket.Analytics.CreateExportRequest;
import synapsedesk.ticket.Analytics.ExportKind;
import synapsedesk.ticket.Analytics.ExportResponse;
import synapsedesk.ticket.Analytics.GetExportRequest;
import synapsedesk.ticket.AnalyticsServiceGrpc;
import tools.jackson.databind.ObjectMapper;

/**
 * `TicketsApi`'s export-and-AI-co-pilot group (the last 3 of group c's 10
 * ops: {@code createExport}, {@code getExport}, {@code listSimilar}). A
 * different dependency shape from the rest of this interface — both talk
 * to {@code AnalyticsServiceGrpc}/{@code AiServiceGrpc}, not {@code
 * TicketServiceGrpc}/{@code AssignmentServiceGrpc} — which is why the
 * survey called this out as its own unit.
 *
 * <p><b>{@code listSimilar} carries {@code ticket.read.all}, not {@code
 * ticket.ai.use}</b> — deliberately: the results are OTHER people's
 * tickets, so the permission that matters is the one governing who may
 * read the queue, not the one governing AI generation budget. Gating on
 * the AI grant instead would let someone with generation budget but no
 * queue access read ticket titles they have no business seeing.
 *
 * <p><b>{@code createExport}'s {@code filters} is a JSON string on the
 * wire</b>, never an object — the same {@code CreateExportRequest} message
 * {@code AuditLogsController} already builds for its own export kind, so
 * the mapper here reproduces that file's exact pattern (an empty map
 * serializes to {@code ""}, "no filters", never {@code "{}"}).
 *
 * <p><b>{@code from}/{@code to} are checked via {@link IsoDateCheck}</b> —
 * Node's {@code @IsISO8601({strict: true})}, reproduced once and shared by
 * every DTO the generator dropped it from (generator-validation defect #3,
 * absent).
 */
@Component
public class TicketsExportAndAiService {

  private static final long DEADLINE_SECONDS = 5;

  private final AnalyticsServiceGrpc.AnalyticsServiceBlockingStub analyticsStub;
  private final AiServiceGrpc.AiServiceBlockingStub aiStub;
  private final ObjectMapper json;

  public TicketsExportAndAiService(
      AnalyticsServiceGrpc.AnalyticsServiceBlockingStub analyticsStub,
      AiServiceGrpc.AiServiceBlockingStub aiStub,
      ObjectMapper json) {
    this.analyticsStub = analyticsStub;
    this.aiStub = aiStub;
    this.json = json;
  }

  public ResponseEntity<TicketsControllerCreateExportV1202Response> createExport(
      RequestContext context, CreateTicketExportDto dto) {
    TicketsCrudService.requirePermission(context, PermissionCodesEnum.TICKET_EXPORT);
    IsoDateCheck.requireIsoDate(dto.getFrom(), "from");
    IsoDateCheck.requireIsoDate(dto.getTo(), "to");

    CreateExportRequest.Builder wire =
        CreateExportRequest.newBuilder()
            .setKind(ExportKind.EXPORT_KIND_TICKET)
            .setFrom(dto.getFrom())
            .setTo(dto.getTo())
            .setFilters(dto.getFilters() == null || dto.getFilters().isEmpty() ? "" : json.writeValueAsString(dto.getFilters()));
    if (dto.getDepartmentId() != null) {
      wire.setDepartmentId(dto.getDepartmentId().toString());
    }

    ExportResponse response = withAnalyticsMetadata(context).createExport(wire.build());

    return new ResponseEntity<>(
        new TicketsControllerCreateExportV1202Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(202))
            .message("OK")
            .data(toExportDto(response)),
        HttpStatus.ACCEPTED);
  }

  public ResponseEntity<TicketsControllerCreateExportV1202Response> getExport(RequestContext context, String id) {
    TicketsCrudService.requirePermission(context, PermissionCodesEnum.TICKET_EXPORT);

    ExportResponse response = withAnalyticsMetadata(context).getExport(GetExportRequest.newBuilder().setId(id).build());

    return ResponseEntity.ok(
        new TicketsControllerCreateExportV1202Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(toExportDto(response)));
  }

  public ResponseEntity<TicketsControllerListSimilarV1200Response> listSimilar(RequestContext context, String id) {
    TicketsCrudService.requirePermission(context, PermissionCodesEnum.TICKET_READ_ALL);

    ListSimilarTicketsResponse response =
        withAiMetadata(context).listSimilarTickets(TicketAiRequest.newBuilder().setTicketId(id).build());

    return ResponseEntity.ok(
        new TicketsControllerListSimilarV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(response.getItemsList().stream().map(TicketsExportAndAiService::toSimilarTicketDto).toList()));
  }

  private static SimilarTicketResponseDto toSimilarTicketDto(SimilarTicketResponse item) {
    return new SimilarTicketResponseDto()
        .ticketId(item.getTicketId())
        .ticketNumber(BigDecimal.valueOf(item.getTicketNumber()))
        .title(item.getTitle())
        .similarityScore(BigDecimal.valueOf(item.getSimilarityScore()));
  }

  private static ExportResponseDto toExportDto(ExportResponse response) {
    return new ExportResponseDto()
        .id(response.getId())
        .status(ExportResponseDto.StatusEnum.fromValue(response.getStatus().name().replace("EXPORT_STATUS_", "")))
        .kind(ExportResponseDto.KindEnum.fromValue(response.getKind().name().replace("EXPORT_KIND_", "")))
        .rowCount(response.hasRowCount() ? BigDecimal.valueOf(response.getRowCount()) : null)
        .rollupComputedAt(response.hasRollupComputedAt() ? TicketsCrudService.toOffsetDateTime(response.getRollupComputedAt()) : null)
        .downloadUrl(response.hasDownloadUrl() ? response.getDownloadUrl() : null)
        .error(response.hasError() ? response.getError() : null)
        .createdAt(response.hasCreatedAt() ? TicketsCrudService.toOffsetDateTime(response.getCreatedAt()) : TicketsCrudService.toOffsetDateTime(com.google.protobuf.Timestamp.getDefaultInstance()))
        .completedAt(response.hasCompletedAt() ? TicketsCrudService.toOffsetDateTime(response.getCompletedAt()) : null);
  }

  private AnalyticsServiceGrpc.AnalyticsServiceBlockingStub withAnalyticsMetadata(RequestContext context) {
    return analyticsStub
        .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
        .withInterceptors(MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context)));
  }

  private AiServiceGrpc.AiServiceBlockingStub withAiMetadata(RequestContext context) {
    return aiStub
        .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
        .withInterceptors(MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context)));
  }
}
