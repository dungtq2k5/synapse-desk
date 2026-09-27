package com.synapsedesk.gateway.ingestionjobs;

import com.synapsedesk.gateway.auth.CurrentRequest;
import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.generated.api.IngestionJobsApi;
import com.synapsedesk.gateway.generated.model.AuthControllerForgotPasswordV1202Response;
import com.synapsedesk.gateway.generated.model.CurrentUserResponseDto.PermissionCodesEnum;
import com.synapsedesk.gateway.generated.model.DocumentsControllerListIngestionJobsV1200Response;
import com.synapsedesk.gateway.generated.model.DocumentsControllerListIngestionJobsV1200ResponseData;
import com.synapsedesk.gateway.generated.model.DocumentsControllerReindexV1202Response;
import com.synapsedesk.gateway.generated.model.InvitationsControllerListV1200ResponseDataMeta;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import com.synapsedesk.gateway.security.RequirePermission;
import io.grpc.stub.MetadataUtils;
import java.math.BigDecimal;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.springframework.http.ResponseEntity;
import org.springframework.lang.Nullable;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import synapsedesk.auth.Common.PageMeta;
import synapsedesk.auth.Common.PageRequest;
import synapsedesk.auth.Common.SortOrder;
import synapsedesk.ingestion.Document.IngestionJobIdRequest;
import synapsedesk.ingestion.Document.IngestionJobStatus;
import synapsedesk.ingestion.Document.ListIngestionJobsRequest;
import synapsedesk.ingestion.Document.ListIngestionJobsResponse;
import synapsedesk.ingestion.DocumentServiceGrpc;

/**
 * `IngestionJobsApi` — the ingestion pipeline worklist, against
 * ingestion-service's `DocumentService` (`ingestion-jobs.controller.ts`
 * reproduced). Reuses the EXISTING {@code documentServiceStub} bean
 * ({@code DocumentsController} already opened it) — no new channel or stub
 * needed.
 *
 * <p><b>{@code status} carries no format validation in the generated
 * interface</b> — the generator drops {@code @IsIn(INGESTION_JOB_STATUSES)}
 * (there is no Bean Validation equivalent to carry an arbitrary-set
 * membership check forward as), so an unrecognized value is refused by
 * hand here, 400, before it can reach {@link IngestionJobStatus#valueOf}
 * and throw the generic {@code IllegalArgumentException} that would
 * otherwise surface as a bare 500. {@code DocumentsController}'s
 * `documentStatusOf`/`documentFileTypeOf` have this same generator-dropped
 * gap and do NOT guard it — a pre-existing, unaddressed asymmetry in an
 * already-shipped interface, not a precedent to copy forward here.
 */
@RestController
public class IngestionJobsController implements IngestionJobsApi {

  private static final long DEADLINE_SECONDS = 5;

  private final DocumentServiceGrpc.DocumentServiceBlockingStub stub;
  private final CurrentUser currentUser;

  public IngestionJobsController(DocumentServiceGrpc.DocumentServiceBlockingStub stub, CurrentUser currentUser) {
    this.stub = stub;
    this.currentUser = currentUser;
  }

  @Override
  @RequirePermission(PermissionCodesEnum.DOCUMENT_READ)
  public ResponseEntity<DocumentsControllerListIngestionJobsV1200Response> ingestionJobsControllerListV1(
      BigDecimal page, BigDecimal limit, String sortBy, String sortOrder, @Nullable String status,
      @Nullable UUID documentId) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    PageRequest pageRequest =
        PageRequest.newBuilder()
            .setPage(page.intValue())
            .setLimit(limit.intValue())
            .setSortBy(sortBy)
            .setSortOrder("DESC".equalsIgnoreCase(sortOrder) ? SortOrder.SORT_ORDER_DESC : SortOrder.SORT_ORDER_ASC)
            .build();

    ListIngestionJobsRequest.Builder wire = ListIngestionJobsRequest.newBuilder().setPage(pageRequest);
    if (status != null) {
      wire.setStatus(ingestionJobStatusOf(status));
    }
    if (documentId != null) {
      wire.setDocumentId(documentId.toString());
    }

    ListIngestionJobsResponse response = withMetadata(context).listIngestionJobs(wire.build());

    DocumentsControllerListIngestionJobsV1200ResponseData data =
        new DocumentsControllerListIngestionJobsV1200ResponseData()
            .items(response.getItemsList().stream().map(IngestionJobMapper::toDto).toList())
            .meta(toMetaDto(response.getMeta()));

    return ResponseEntity.ok(
        new DocumentsControllerListIngestionJobsV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(data));
  }

  @Override
  @RequirePermission(PermissionCodesEnum.DOCUMENT_READ)
  public ResponseEntity<DocumentsControllerReindexV1202Response> ingestionJobsControllerGetV1(String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    var response = withMetadata(context).getIngestionJob(IngestionJobIdRequest.newBuilder().setId(id).build());

    return ResponseEntity.ok(
        new DocumentsControllerReindexV1202Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(IngestionJobMapper.toDto(response)));
  }

  @Override
  @RequirePermission(PermissionCodesEnum.DOCUMENT_REINDEX)
  public ResponseEntity<DocumentsControllerReindexV1202Response> ingestionJobsControllerRetryV1(String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    var response = withMetadata(context).retryIngestionJob(IngestionJobIdRequest.newBuilder().setId(id).build());

    return ResponseEntity.ok(
        new DocumentsControllerReindexV1202Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("Ingestion retry queued")
            .data(IngestionJobMapper.toDto(response)));
  }

  @Override
  @RequirePermission(PermissionCodesEnum.DOCUMENT_REINDEX)
  public ResponseEntity<AuthControllerForgotPasswordV1202Response> ingestionJobsControllerCancelV1(String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    // `cancelled` is discarded: the only false it could carry is a failure,
    // and a failure arrives as an exception — same pattern as
    // `documentsControllerDeleteFlagV1`'s discarded `deleted`.
    withMetadata(context).cancelIngestionJob(IngestionJobIdRequest.newBuilder().setId(id).build());

    return ResponseEntity.noContent().build();
  }

  private static IngestionJobStatus ingestionJobStatusOf(String value) {
    try {
      return IngestionJobStatus.valueOf("INGESTION_JOB_STATUS_" + value);
    } catch (IllegalArgumentException e) {
      throw new ResponseStatusException(
          org.springframework.http.HttpStatus.BAD_REQUEST, "status must be a recognized ingestion job status");
    }
  }

  private static InvitationsControllerListV1200ResponseDataMeta toMetaDto(PageMeta meta) {
    return new InvitationsControllerListV1200ResponseDataMeta(
        BigDecimal.valueOf(meta.getTotalItems()),
        BigDecimal.valueOf(meta.getItemCount()),
        BigDecimal.valueOf(meta.getItemsPerPage()),
        BigDecimal.valueOf(meta.getTotalPages()),
        BigDecimal.valueOf(meta.getCurrentPage()));
  }

  private DocumentServiceGrpc.DocumentServiceBlockingStub withMetadata(RequestContext context) {
    return stub.withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
        .withInterceptors(MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context)));
  }
}
