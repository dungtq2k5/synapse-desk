package com.synapsedesk.gateway.ingestionjobs;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.google.protobuf.Timestamp;
import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.web.SortDirection;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.server.ResponseStatusException;
import synapsedesk.ingestion.Document.CancelIngestionJobResponse;
import synapsedesk.ingestion.Document.IngestionJobResponse;
import synapsedesk.ingestion.Document.IngestionJobStatus;
import synapsedesk.ingestion.Document.ListIngestionJobsRequest;
import synapsedesk.ingestion.Document.ListIngestionJobsResponse;
import synapsedesk.ingestion.DocumentServiceGrpc;

/**
 * `IngestionJobsApi`'s 4 operations. The sharpest property: an unrecognized
 * `status` filter must 400, not silently reach {@code IngestionJobStatus
 * .valueOf} and surface as a bare 500 — the generator dropped Node's
 * `@IsIn(INGESTION_JOB_STATUSES)`, so this guard exists only here.
 */
class IngestionJobsControllerTest {

  private final DocumentServiceGrpc.DocumentServiceBlockingStub stub = mock(
    DocumentServiceGrpc.DocumentServiceBlockingStub.class
  );
  private final CurrentUser currentUser = mock(CurrentUser.class);
  private IngestionJobsController controller;

  private static RequestContext context() {
    return new RequestContext(
      "agent-1",
      "org-1",
      false,
      List.of(),
      List.of("document.read", "document.reindex"),
      true,
      "127.0.0.1",
      "test"
    );
  }

  @BeforeEach
  void setUp() {
    when(stub.withDeadlineAfter(anyLong(), any())).thenReturn(stub);
    when(stub.withInterceptors(any())).thenReturn(stub);
    when(currentUser.require(any())).thenReturn(context());
    controller = new IngestionJobsController(stub, currentUser);

    MockHttpServletRequest request = new MockHttpServletRequest();
    RequestContextHolder.setRequestAttributes(
      new ServletRequestAttributes(request)
    );
  }

  @AfterEach
  void tearDown() {
    RequestContextHolder.resetRequestAttributes();
  }

  @Test
  void listRefusesAnUnrecognizedStatusWith400NotAPeerCall() {
    assertThatThrownBy(() ->
      controller.ingestionJobsControllerListV1(
        java.math.BigDecimal.ONE,
        java.math.BigDecimal.TEN,
        "createdAt",
        SortDirection.ASC,
        "NOT_A_REAL_STATUS",
        null
      )
    ).isInstanceOf(ResponseStatusException.class);

    verify(stub, never()).listIngestionJobs(any());
  }

  @Test
  void listForwardsARecognizedStatusFilter() {
    when(stub.listIngestionJobs(any())).thenReturn(
      ListIngestionJobsResponse.getDefaultInstance()
    );

    controller.ingestionJobsControllerListV1(
      java.math.BigDecimal.ONE,
      java.math.BigDecimal.TEN,
      "createdAt",
      SortDirection.ASC,
      "FAILED",
      null
    );

    ArgumentCaptor<ListIngestionJobsRequest> captor = ArgumentCaptor.forClass(
      ListIngestionJobsRequest.class
    );
    verify(stub).listIngestionJobs(captor.capture());
    assertThat(captor.getValue().getStatus()).isEqualTo(
      IngestionJobStatus.INGESTION_JOB_STATUS_FAILED
    );
  }

  @Test
  void listForwardsTheDocumentIdFilter() {
    when(stub.listIngestionJobs(any())).thenReturn(
      ListIngestionJobsResponse.getDefaultInstance()
    );
    UUID documentId = UUID.randomUUID();

    controller.ingestionJobsControllerListV1(
      java.math.BigDecimal.ONE,
      java.math.BigDecimal.TEN,
      "createdAt",
      SortDirection.ASC,
      null,
      documentId
    );

    ArgumentCaptor<ListIngestionJobsRequest> captor = ArgumentCaptor.forClass(
      ListIngestionJobsRequest.class
    );
    verify(stub).listIngestionJobs(captor.capture());
    assertThat(captor.getValue().getDocumentId()).isEqualTo(
      documentId.toString()
    );
  }

  @Test
  void getReturns200NotTheReindexRoutes202() {
    when(stub.getIngestionJob(any())).thenReturn(wireJob());

    var response = controller.ingestionJobsControllerGetV1("job-1");

    assertThat(response.getStatusCode().value()).isEqualTo(200);
  }

  @Test
  void retryReturns200WithTheQueuedMessage() {
    when(stub.retryIngestionJob(any())).thenReturn(wireJob());

    var response = controller.ingestionJobsControllerRetryV1("job-1");

    assertThat(response.getStatusCode().value()).isEqualTo(200);
    assertThat(response.getBody().message()).isEqualTo(
      "Ingestion retry queued"
    );
  }

  @Test
  void cancelReturns204AndDiscardsTheCancelledFlag() {
    when(stub.cancelIngestionJob(any())).thenReturn(
      CancelIngestionJobResponse.newBuilder().setCancelled(false).build()
    );

    var response = controller.ingestionJobsControllerCancelV1("job-1");

    assertThat(response.getStatusCode().value()).isEqualTo(204);
  }

  private static IngestionJobResponse wireJob() {
    Timestamp now = Timestamp.newBuilder().setSeconds(1_756_684_800).build();
    return IngestionJobResponse.newBuilder()
      .setId("job-1")
      .setDocumentId("doc-1")
      .setBullmqJobId("bullmq-1")
      .setStatus(IngestionJobStatus.INGESTION_JOB_STATUS_COMPLETED)
      .setCreatedAt(now)
      .build();
  }
}
