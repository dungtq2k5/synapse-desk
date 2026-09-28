package com.synapsedesk.gateway.tickets;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.generated.model.CreateTicketExportDto;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.web.server.ResponseStatusException;
import synapsedesk.ticket.Ai.ListSimilarTicketsResponse;
import synapsedesk.ticket.Ai.SimilarTicketResponse;
import synapsedesk.ticket.AiServiceGrpc;
import synapsedesk.ticket.Analytics.CreateExportRequest;
import synapsedesk.ticket.Analytics.ExportKind;
import synapsedesk.ticket.Analytics.ExportResponse;
import synapsedesk.ticket.Analytics.ExportStatus;
import synapsedesk.ticket.AnalyticsServiceGrpc;
import tools.jackson.databind.ObjectMapper;

/**
 * `TicketsApi`'s export-and-AI group (group c, part 2). Two properties
 * matter here: the ISO-8601 check on {@code from}/{@code to} — a defect
 * shape (#3, absent) this port has fixed in every other from/to pair it has
 * touched, but which its own template ({@code AuditLogsController}) never
 * got — and {@code listSimilar}'s permission code, which is deliberately
 * {@code ticket.read.all} and not the AI-usage code.
 */
class TicketsExportAndAiServiceTest {

  private final AnalyticsServiceGrpc.AnalyticsServiceBlockingStub analyticsStub =
    mock(AnalyticsServiceGrpc.AnalyticsServiceBlockingStub.class);
  private final AiServiceGrpc.AiServiceBlockingStub aiStub = mock(
    AiServiceGrpc.AiServiceBlockingStub.class
  );
  private TicketsExportAndAiService service;

  private static RequestContext contextWithCodes(List<String> codes) {
    return new RequestContext(
      "agent-1",
      "org-1",
      false,
      List.of(),
      codes,
      true,
      "127.0.0.1",
      "test"
    );
  }

  @BeforeEach
  void setUp() {
    when(analyticsStub.withDeadlineAfter(anyLong(), any())).thenReturn(
      analyticsStub
    );
    when(analyticsStub.withInterceptors(any())).thenReturn(analyticsStub);
    when(aiStub.withDeadlineAfter(anyLong(), any())).thenReturn(aiStub);
    when(aiStub.withInterceptors(any())).thenReturn(aiStub);
    service = new TicketsExportAndAiService(
      analyticsStub,
      aiStub,
      new ObjectMapper()
    );
  }

  @Test
  void createExportRefusesAMalformedFromDate() {
    CreateTicketExportDto dto = new CreateTicketExportDto();
    dto.setFrom("not-a-date");
    dto.setTo("2026-09-01");

    assertThatThrownBy(() ->
      service.createExport(contextWithCodes(List.of("ticket.export")), dto)
    ).isInstanceOf(ResponseStatusException.class);
    verify(analyticsStub, never()).createExport(any());
  }

  @Test
  void createExportAcceptsABareCalendarDate() {
    when(analyticsStub.createExport(any())).thenReturn(wireExport());
    CreateTicketExportDto dto = new CreateTicketExportDto();
    dto.setFrom("2026-01-01");
    dto.setTo("2026-09-01");

    var response = service.createExport(
      contextWithCodes(List.of("ticket.export")),
      dto
    );

    assertThat(response.getStatusCode().value()).isEqualTo(202);
  }

  @Test
  void createExportAcceptsAFullIsoTimestamp() {
    when(analyticsStub.createExport(any())).thenReturn(wireExport());
    CreateTicketExportDto dto = new CreateTicketExportDto();
    dto.setFrom("2026-01-01T00:00:00Z");
    dto.setTo("2026-09-01T23:59:59Z");

    var response = service.createExport(
      contextWithCodes(List.of("ticket.export")),
      dto
    );

    assertThat(response.getStatusCode().value()).isEqualTo(202);
  }

  @Test
  void createExportSerializesFiltersAsJsonAndEmptyAsBlank() {
    when(analyticsStub.createExport(any())).thenReturn(wireExport());
    CreateTicketExportDto dto = new CreateTicketExportDto();
    dto.setFrom("2026-01-01");
    dto.setTo("2026-09-01");
    dto.setFilters(Map.of("status", "OPEN"));

    service.createExport(contextWithCodes(List.of("ticket.export")), dto);

    ArgumentCaptor<CreateExportRequest> captor = ArgumentCaptor.forClass(
      CreateExportRequest.class
    );
    verify(analyticsStub).createExport(captor.capture());
    assertThat(captor.getValue().getKind()).isEqualTo(
      ExportKind.EXPORT_KIND_TICKET
    );
    assertThat(captor.getValue().getFilters()).contains("OPEN");
  }

  @Test
  void createExportRefusesForACallerWithoutTicketExport() {
    CreateTicketExportDto dto = new CreateTicketExportDto();
    dto.setFrom("2026-01-01");
    dto.setTo("2026-09-01");

    assertThatThrownBy(() ->
      service.createExport(contextWithCodes(List.of()), dto)
    ).isInstanceOf(ResponseStatusException.class);
  }

  @Test
  void listSimilarRequiresTicketReadAllNotAnAiCode() {
    assertThatThrownBy(() ->
      service.listSimilar(
        contextWithCodes(List.of("ticket.ai.use")),
        "ticket-1"
      )
    ).isInstanceOf(ResponseStatusException.class);
    verify(aiStub, never()).listSimilarTickets(any());

    when(aiStub.listSimilarTickets(any())).thenReturn(
      ListSimilarTicketsResponse.newBuilder()
        .addItems(
          SimilarTicketResponse.newBuilder()
            .setTicketId("ticket-2")
            .setTicketNumber(42)
            .setTitle("Similar")
            .setSimilarityScore(0.9)
            .build()
        )
        .build()
    );

    var response = service.listSimilar(
      contextWithCodes(List.of("ticket.read.all")),
      "ticket-1"
    );

    assertThat(response.getBody().getData()).hasSize(1);
    assertThat(response.getBody().getData().get(0).getTicketId()).isEqualTo(
      "ticket-2"
    );
  }

  private static ExportResponse wireExport() {
    return ExportResponse.newBuilder()
      .setId("export-1")
      .setStatus(ExportStatus.EXPORT_STATUS_PENDING)
      .setKind(ExportKind.EXPORT_KIND_TICKET)
      .build();
  }
}
