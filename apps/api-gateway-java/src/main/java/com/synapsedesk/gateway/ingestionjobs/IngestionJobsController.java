package com.synapsedesk.gateway.ingestionjobs;

import com.synapsedesk.gateway.auth.CurrentRequest;
import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.generated.model.CurrentUserResponseDto.PermissionCodesEnum;
import com.synapsedesk.gateway.generated.model.IngestionJobResponseDto;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import com.synapsedesk.gateway.openapi.ApiErrors;
import com.synapsedesk.gateway.security.RequirePermission;
import com.synapsedesk.gateway.web.ApiPaths;
import com.synapsedesk.gateway.web.ApiResponse;
import com.synapsedesk.gateway.web.PageMeta;
import com.synapsedesk.gateway.web.PagedData;
import io.grpc.stub.MetadataUtils;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import java.math.BigDecimal;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.lang.Nullable;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
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
 *
 * <p><b>Migrated off `IngestionJobsApi`.</b> `cancel` answers 204 with an
 * empty body — {@code @ResponseStatus} is what tells springdoc that.
 */
@Tag(name = "Ingestion Jobs")
@RestController
@RequestMapping(ApiPaths.V1)
@Validated
public class IngestionJobsController {

  private static final long DEADLINE_SECONDS = 5;

  private final DocumentServiceGrpc.DocumentServiceBlockingStub stub;
  private final CurrentUser currentUser;

  public IngestionJobsController(
    DocumentServiceGrpc.DocumentServiceBlockingStub stub,
    CurrentUser currentUser
  ) {
    this.stub = stub;
    this.currentUser = currentUser;
  }

  @GetMapping(value = "/ingestion-jobs", produces = { "application/json" })
  @ApiErrors({ "401", "403" })
  @RequirePermission(PermissionCodesEnum.DOCUMENT_READ)
  public ResponseEntity<
    ApiResponse<PagedData<IngestionJobResponseDto>>
  > ingestionJobsControllerListV1(
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
    ) String sortOrder,
    @Valid @RequestParam(
      value = "status",
      required = false
    ) @Nullable String status,
    @Valid @RequestParam(
      value = "documentId",
      required = false
    ) @Nullable UUID documentId
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    PageRequest pageRequest = PageRequest.newBuilder()
      .setPage(page.intValue())
      .setLimit(limit.intValue())
      .setSortBy(sortBy)
      .setSortOrder(
        "DESC".equalsIgnoreCase(sortOrder)
          ? SortOrder.SORT_ORDER_DESC
          : SortOrder.SORT_ORDER_ASC
      )
      .build();

    ListIngestionJobsRequest.Builder wire =
      ListIngestionJobsRequest.newBuilder().setPage(pageRequest);
    if (status != null) {
      wire.setStatus(ingestionJobStatusOf(status));
    }
    if (documentId != null) {
      wire.setDocumentId(documentId.toString());
    }

    ListIngestionJobsResponse response = withMetadata(
      context
    ).listIngestionJobs(wire.build());

    PagedData<IngestionJobResponseDto> data = new PagedData<>(
      response.getItemsList().stream().map(IngestionJobMapper::toDto).toList(),
      PageMeta.from(response.getMeta())
    );

    return ResponseEntity.ok(ApiResponse.of(200, "OK", data));
  }

  @GetMapping(value = "/ingestion-jobs/{id}", produces = { "application/json" })
  @ApiErrors({ "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.DOCUMENT_READ)
  public ResponseEntity<
    ApiResponse<IngestionJobResponseDto>
  > ingestionJobsControllerGetV1(@PathVariable("id") String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    var response = withMetadata(context).getIngestionJob(
      IngestionJobIdRequest.newBuilder().setId(id).build()
    );

    return ResponseEntity.ok(
      ApiResponse.of(200, "OK", IngestionJobMapper.toDto(response))
    );
  }

  @PostMapping(
    value = "/ingestion-jobs/{id}/retry",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.DOCUMENT_REINDEX)
  public ResponseEntity<
    ApiResponse<IngestionJobResponseDto>
  > ingestionJobsControllerRetryV1(@PathVariable("id") String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    var response = withMetadata(context).retryIngestionJob(
      IngestionJobIdRequest.newBuilder().setId(id).build()
    );

    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "Ingestion retry queued",
        IngestionJobMapper.toDto(response)
      )
    );
  }

  @DeleteMapping(
    value = "/ingestion-jobs/{id}",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @ResponseStatus(HttpStatus.NO_CONTENT)
  @RequirePermission(PermissionCodesEnum.DOCUMENT_REINDEX)
  public ResponseEntity<ApiResponse<Void>> ingestionJobsControllerCancelV1(
    @PathVariable("id") String id
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    // `cancelled` is discarded: the only false it could carry is a failure,
    // and a failure arrives as an exception — same pattern as
    // `documentsControllerDeleteFlagV1`'s discarded `deleted`.
    withMetadata(context).cancelIngestionJob(
      IngestionJobIdRequest.newBuilder().setId(id).build()
    );

    return ResponseEntity.noContent().build();
  }

  private static IngestionJobStatus ingestionJobStatusOf(String value) {
    try {
      return IngestionJobStatus.valueOf("INGESTION_JOB_STATUS_" + value);
    } catch (IllegalArgumentException e) {
      throw new ResponseStatusException(
        HttpStatus.BAD_REQUEST,
        "status must be a recognized ingestion job status"
      );
    }
  }

  private DocumentServiceGrpc.DocumentServiceBlockingStub withMetadata(
    RequestContext context
  ) {
    return stub
      .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
      .withInterceptors(
        MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context))
      );
  }
}
