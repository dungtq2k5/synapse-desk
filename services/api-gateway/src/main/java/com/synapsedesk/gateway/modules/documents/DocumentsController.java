package com.synapsedesk.gateway.modules.documents;

import com.synapsedesk.gateway.common.auth.CurrentRequest;
import com.synapsedesk.gateway.common.auth.CurrentUser;
import com.synapsedesk.gateway.common.auth.RequestContext;
import com.synapsedesk.gateway.common.cache.CacheService;
import com.synapsedesk.gateway.common.cache.EvictsCache;
import com.synapsedesk.gateway.common.dto.CurrentUserResponseDto.PermissionCodesEnum;
import com.synapsedesk.gateway.common.dto.UploadMethod;
import com.synapsedesk.gateway.common.grpc.CallerMetadata;
import com.synapsedesk.gateway.common.openapi.ApiErrors;
import com.synapsedesk.gateway.common.openapi.CachedRead;
import com.synapsedesk.gateway.common.security.RequirePermission;
import com.synapsedesk.gateway.common.web.ApiPaths;
import com.synapsedesk.gateway.common.web.ApiResponse;
import com.synapsedesk.gateway.common.web.PageMeta;
import com.synapsedesk.gateway.common.web.PagedData;
import com.synapsedesk.gateway.common.web.SortDirection;
import com.synapsedesk.gateway.modules.documents.dto.rest.ConfirmDocumentDto;
import com.synapsedesk.gateway.modules.documents.dto.rest.DocumentChunkResponseDto;
import com.synapsedesk.gateway.modules.documents.dto.rest.DocumentChunkSortField;
import com.synapsedesk.gateway.modules.documents.dto.rest.DocumentDepartmentsResponseDto;
import com.synapsedesk.gateway.modules.documents.dto.rest.DocumentFileTypeFilter;
import com.synapsedesk.gateway.modules.documents.dto.rest.DocumentFlagResponseDto;
import com.synapsedesk.gateway.modules.documents.dto.rest.DocumentResponseDto;
import com.synapsedesk.gateway.modules.documents.dto.rest.DocumentStatusFilter;
import com.synapsedesk.gateway.modules.documents.dto.rest.DownloadDocumentResponseDto;
import com.synapsedesk.gateway.modules.documents.dto.rest.FlagSeverityFilter;
import com.synapsedesk.gateway.modules.documents.dto.rest.PresignDocumentDto;
import com.synapsedesk.gateway.modules.documents.dto.rest.PresignDocumentResponseDto;
import com.synapsedesk.gateway.modules.documents.dto.rest.ReplaceDocumentDto;
import com.synapsedesk.gateway.modules.documents.dto.rest.ResolveDocumentFlagDto;
import com.synapsedesk.gateway.modules.documents.dto.rest.SetDocumentDepartmentsDto;
import com.synapsedesk.gateway.modules.documents.dto.rest.StorageUsageResponseDto;
import com.synapsedesk.gateway.modules.documents.dto.rest.UpdateDocumentDto;
import com.synapsedesk.gateway.modules.ingestionjobs.IngestionJobMapper;
import com.synapsedesk.gateway.modules.ingestionjobs.dto.rest.IngestionJobResponseDto;
import io.grpc.stub.MetadataUtils;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import java.math.BigDecimal;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.jspecify.annotations.Nullable;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import synapsedesk.auth.Common.PageRequest;
import synapsedesk.auth.Common.SortOrder;
import synapsedesk.ingestion.Document.ConfirmDocumentRequest;
import synapsedesk.ingestion.Document.DocumentChunkResponse;
import synapsedesk.ingestion.Document.DocumentFileType;
import synapsedesk.ingestion.Document.DocumentFlagIdRequest;
import synapsedesk.ingestion.Document.DocumentFlagResolution;
import synapsedesk.ingestion.Document.DocumentFlagResponse;
import synapsedesk.ingestion.Document.DocumentFlagSeverity;
import synapsedesk.ingestion.Document.DocumentFlagType;
import synapsedesk.ingestion.Document.DocumentIdRequest;
import synapsedesk.ingestion.Document.DocumentResponse;
import synapsedesk.ingestion.Document.DocumentStatus;
import synapsedesk.ingestion.Document.DownloadDocumentResponse;
import synapsedesk.ingestion.Document.GetDocumentChunkRequest;
import synapsedesk.ingestion.Document.IngestionJobResponse;
import synapsedesk.ingestion.Document.ListDocumentChunksRequest;
import synapsedesk.ingestion.Document.ListDocumentChunksResponse;
import synapsedesk.ingestion.Document.ListDocumentDepartmentsResponse;
import synapsedesk.ingestion.Document.ListDocumentFlagsRequest;
import synapsedesk.ingestion.Document.ListDocumentFlagsResponse;
import synapsedesk.ingestion.Document.ListDocumentsRequest;
import synapsedesk.ingestion.Document.ListDocumentsResponse;
import synapsedesk.ingestion.Document.PresignDocumentRequest;
import synapsedesk.ingestion.Document.PresignDocumentResponse;
import synapsedesk.ingestion.Document.ReplaceDocumentRequest;
import synapsedesk.ingestion.Document.ResolveDocumentFlagRequest;
import synapsedesk.ingestion.Document.SetDocumentDepartmentsRequest;
import synapsedesk.ingestion.Document.StorageUsageResponse;
import synapsedesk.ingestion.Document.UpdateDocumentRequest;
import synapsedesk.ingestion.DocumentServiceGrpc;

/**
 * `DocumentsApi` — the knowledge base, against ingestion-service's
 * `DocumentService`. A stub (`documentServiceStub`) on the shared
 * `ingestionServiceChannel` — the
 * gateway never speaks to storage-service directly; ingestion-service does,
 * which is what makes presign/confirm/replace ordinary RPC forwards here.
 *
 * <p><b>`list` is the one cached route.</b> The cache key is the RAW query
 * string plus a visibility digest of the caller's departments, and the cached
 * VALUE is the full envelope, not just the DTO. The key is built from the
 * request's raw query parameters, before any default-filling, not from the
 * bound/defaulted method arguments, so an omitted param and its explicit
 * default are cached as different entries.
 *
 * <p><b>Migrated off `DocumentsApi`.</b> {@code list}'s cache goes through
 * {@link CacheService#wrapTyped} — a bare {@code Class<T>} would erase
 * {@code ApiResponse<PagedData<DocumentResponseDto>>}'s own type arguments
 * on a cache HIT, the same defect fixed in {@code RolesController.list}.
 * {@code confirm} answers 201, {@code reindex}/{@code replace} answer 202,
 * {@code deleteFlag}/{@code remove} answer 204 — {@code @ResponseStatus} is
 * what tells springdoc that.
 */
@Tag(name = "Documents")
@RestController
@RequestMapping(ApiPaths.V1)
@Validated
public class DocumentsController {

  private static final long DEADLINE_SECONDS = 5;
  private static final String CACHE_SCOPE = "documents";
  private static final long LIST_CACHE_TTL_SECONDS = 60;

  private final DocumentServiceGrpc.DocumentServiceBlockingStub stub;
  private final CurrentUser currentUser;
  private final CacheService cache;

  public DocumentsController(
    DocumentServiceGrpc.DocumentServiceBlockingStub stub,
    CurrentUser currentUser,
    CacheService cache
  ) {
    this.stub = stub;
    this.currentUser = currentUser;
    this.cache = cache;
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

  @CachedRead(
    scope = CACHE_SCOPE,
    ttlSeconds = LIST_CACHE_TTL_SECONDS,
    varyBy = CachedRead.VaryBy.CALLER
  )
  @GetMapping(value = "/documents", produces = { "application/json" })
  @ApiErrors({ "401" })
  public ResponseEntity<
    ApiResponse<PagedData<DocumentResponseDto>>
  > documentsControllerListV1(
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
      value = "includeDeleted",
      required = false,
      defaultValue = "false"
    ) Boolean includeDeleted,
    @Valid @RequestParam(
      value = "status",
      required = false
    ) @Nullable DocumentStatusFilter status,
    @Valid @RequestParam(
      value = "departmentId",
      required = false
    ) @Nullable UUID departmentId,
    @Valid @RequestParam(
      value = "fileType",
      required = false
    ) @Nullable DocumentFileTypeFilter fileType
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    Map<String, String> rawParams = new TreeMap<>();
    CurrentRequest.request()
      .getParameterMap()
      .forEach((name, values) -> {
        if (values.length > 0 && !values[0].isEmpty()) {
          rawParams.put(name, values[0]);
        }
      });
    rawParams.put("__visibility", visibilityDigest(context));

    String key = cache.buildKey(
      context.organizationId(),
      CACHE_SCOPE,
      rawParams
    );

    ApiResponse<PagedData<DocumentResponseDto>> envelope = cache.wrapTyped(
      key,
      LIST_CACHE_TTL_SECONDS,
      new tools.jackson.core.type.TypeReference<
        ApiResponse<PagedData<DocumentResponseDto>>
      >() {},
      () -> {
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

        ListDocumentsRequest.Builder wire =
          ListDocumentsRequest.newBuilder().setPage(pageRequest);
        if (departmentId != null) {
          wire.setDepartmentId(departmentId.toString());
        }
        if (status != null) {
          wire.setStatus(documentStatusOf(status.name()));
        }
        if (fileType != null) {
          wire.setFileType(documentFileTypeOf(fileType.name()));
        }
        if (includeDeleted != null) {
          wire.setIncludeDeleted(includeDeleted);
        }

        ListDocumentsResponse response = withMetadata(context).listDocuments(
          wire.build()
        );

        PagedData<DocumentResponseDto> data = new PagedData<>(
          response
            .getItemsList()
            .stream()
            .map(DocumentsController::toDto)
            .toList(),
          PageMeta.from(response.getMeta())
        );

        return ApiResponse.of(200, "OK", data);
      }
    );

    return ResponseEntity.ok(envelope);
  }

  @GetMapping(value = "/documents/storage", produces = { "application/json" })
  @ApiErrors({ "401", "403" })
  @RequirePermission(PermissionCodesEnum.DOCUMENT_READ)
  public ResponseEntity<
    ApiResponse<StorageUsageResponseDto>
  > documentsControllerStorageUsageV1() {
    RequestContext context = currentUser.require(CurrentRequest.request());

    // Blank id, ignored server-side — a workspace total, not a per-document one.
    StorageUsageResponse response = withMetadata(context).getStorageUsage(
      DocumentIdRequest.newBuilder().setId("").build()
    );

    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "OK",
        new StorageUsageResponseDto(
          BigDecimal.valueOf(response.getUsedBytes()),
          BigDecimal.valueOf(response.getLimitBytes()),
          BigDecimal.valueOf(response.getDocumentCount())
        )
      )
    );
  }

  @GetMapping(value = "/documents/flags", produces = { "application/json" })
  @ApiErrors({ "401", "403" })
  @RequirePermission(PermissionCodesEnum.DOCUMENT_READ)
  public ResponseEntity<
    ApiResponse<PagedData<DocumentFlagResponseDto>>
  > documentsControllerListFlagsV1(
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
      defaultValue = "detectedAt"
    ) String sortBy,
    @Valid @RequestParam(
      value = "sortOrder",
      required = false,
      defaultValue = "ASC"
    ) SortDirection sortOrder,
    @Valid @RequestParam(
      value = "type",
      required = false
    ) @Nullable List<String> type,
    @Valid @RequestParam(
      value = "includeResolved",
      required = false,
      defaultValue = "false"
    ) Boolean includeResolved,
    @Valid @RequestParam(
      value = "severity",
      required = false
    ) @Nullable FlagSeverityFilter severity,
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
        sortOrder == SortDirection.DESC
          ? SortOrder.SORT_ORDER_DESC
          : SortOrder.SORT_ORDER_ASC
      )
      .build();

    ListDocumentFlagsRequest.Builder wire =
      ListDocumentFlagsRequest.newBuilder().setPage(pageRequest);
    if (type != null) {
      type.forEach(t -> wire.addFlagTypes(documentFlagTypeOf(t)));
    }
    if (severity != null) {
      wire.setSeverity(documentFlagSeverityOf(severity.name()));
    }
    if (documentId != null) {
      wire.setDocumentId(documentId.toString());
    }
    if (includeResolved != null) {
      wire.setIncludeResolved(includeResolved);
    }

    ListDocumentFlagsResponse response = withMetadata(
      context
    ).listDocumentFlags(wire.build());

    PagedData<DocumentFlagResponseDto> data = new PagedData<>(
      response
        .getItemsList()
        .stream()
        .map(DocumentsController::toFlagDto)
        .toList(),
      PageMeta.from(response.getMeta())
    );

    return ResponseEntity.ok(ApiResponse.of(200, "OK", data));
  }

  @GetMapping(
    value = "/documents/flags/{flagId}",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.DOCUMENT_READ)
  public ResponseEntity<
    ApiResponse<DocumentFlagResponseDto>
  > documentsControllerGetFlagV1(@PathVariable("flagId") String flagId) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    DocumentFlagResponse response = withMetadata(context).getDocumentFlag(
      DocumentFlagIdRequest.newBuilder().setId(flagId).build()
    );

    return okFlag(response, "OK");
  }

  @EvictsCache(CACHE_SCOPE)
  @PostMapping(
    value = "/documents/flags/{flagId}/dismiss",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.DOCUMENT_UPDATE)
  public ResponseEntity<
    ApiResponse<DocumentFlagResponseDto>
  > documentsControllerDismissFlagV1(
    @PathVariable("flagId") String flagId,
    @Valid @RequestBody ResolveDocumentFlagDto resolveDocumentFlagDto
  ) {
    return resolveFlag(
      flagId,
      DocumentFlagResolution.DOCUMENT_FLAG_RESOLUTION_DISMISSED,
      resolveDocumentFlagDto,
      "Flag dismissed"
    );
  }

  @EvictsCache(CACHE_SCOPE)
  @PostMapping(
    value = "/documents/flags/{flagId}/fixed",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.DOCUMENT_UPDATE)
  public ResponseEntity<
    ApiResponse<DocumentFlagResponseDto>
  > documentsControllerFixFlagV1(
    @PathVariable("flagId") String flagId,
    @Valid @RequestBody ResolveDocumentFlagDto resolveDocumentFlagDto
  ) {
    return resolveFlag(
      flagId,
      DocumentFlagResolution.DOCUMENT_FLAG_RESOLUTION_FIXED,
      resolveDocumentFlagDto,
      "Flag marked fixed"
    );
  }

  @EvictsCache(CACHE_SCOPE)
  @PostMapping(
    value = "/documents/flags/{flagId}/replaced",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.DOCUMENT_UPDATE)
  public ResponseEntity<
    ApiResponse<DocumentFlagResponseDto>
  > documentsControllerReplaceFlagV1(
    @PathVariable("flagId") String flagId,
    @Valid @RequestBody ResolveDocumentFlagDto resolveDocumentFlagDto
  ) {
    return resolveFlag(
      flagId,
      DocumentFlagResolution.DOCUMENT_FLAG_RESOLUTION_DOCUMENT_REPLACED,
      resolveDocumentFlagDto,
      "Flag marked replaced"
    );
  }

  private ResponseEntity<ApiResponse<DocumentFlagResponseDto>> resolveFlag(
    String flagId,
    DocumentFlagResolution resolution,
    ResolveDocumentFlagDto dto,
    String message
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    ResolveDocumentFlagRequest.Builder wire =
      ResolveDocumentFlagRequest.newBuilder()
        .setId(flagId)
        .setResolution(resolution);
    if (dto.getComment() != null) {
      wire.setComment(dto.getComment());
    }

    DocumentFlagResponse response = withMetadata(context).resolveDocumentFlag(
      wire.build()
    );

    return okFlag(response, message);
  }

  private ResponseEntity<ApiResponse<DocumentFlagResponseDto>> okFlag(
    DocumentFlagResponse response,
    String message
  ) {
    return ResponseEntity.ok(ApiResponse.of(200, message, toFlagDto(response)));
  }

  @EvictsCache(CACHE_SCOPE)
  @DeleteMapping(
    value = "/documents/flags/{flagId}",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @ResponseStatus(HttpStatus.NO_CONTENT)
  @RequirePermission(PermissionCodesEnum.DOCUMENT_DELETE)
  public ResponseEntity<Void> documentsControllerDeleteFlagV1(
    @PathVariable("flagId") String flagId
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    // `deleted` is discarded: the only false it could carry is a failure, and a
    // failure arrives as an exception.
    withMetadata(context).deleteDocumentFlag(
      DocumentFlagIdRequest.newBuilder().setId(flagId).build()
    );

    return ResponseEntity.noContent().build();
  }

  @EvictsCache(CACHE_SCOPE)
  @PostMapping(
    value = "/documents/presign",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors(
    value = { "400", "401", "402", "403" },
    descriptions = @ApiErrors.Description(
      status = "402",
      value = "A plan limit: the organization's document storage is full, or it " +
        "holds its plan's document count. `error` is the sentence to show " +
        "(\"Your document storage is full. …\" or \"You have reached the " +
        "document limit on your plan. …\"). A file over the organization's " +
        "size limit is a 400; the rate limit stays a 429."
    )
  )
  @RequirePermission(PermissionCodesEnum.DOCUMENT_CREATE)
  public ResponseEntity<
    ApiResponse<PresignDocumentResponseDto>
  > documentsControllerPresignV1(
    @Valid @RequestBody PresignDocumentDto presignDocumentDto
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    PresignDocumentResponse response = withMetadata(context).presignDocument(
      PresignDocumentRequest.newBuilder()
        .setContentType(presignDocumentDto.getContentType().getValue())
        .setSizeBytes(presignDocumentDto.getSizeBytes().longValue())
        .setFileName(presignDocumentDto.getFileName())
        .build()
    );

    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "OK",
        new PresignDocumentResponseDto(
          response.getUploadUrl(),
          UploadMethod.of(response.getUploadMethod()),
          response.getObjectPath(),
          toOffsetDateTime(response.getExpiresAt())
        )
      )
    );
  }

  @EvictsCache(CACHE_SCOPE)
  @PostMapping(
    value = "/documents/confirm",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403" })
  @ResponseStatus(HttpStatus.CREATED)
  @RequirePermission(PermissionCodesEnum.DOCUMENT_CREATE)
  public ResponseEntity<
    ApiResponse<DocumentResponseDto>
  > documentsControllerConfirmV1(
    @Valid @RequestBody ConfirmDocumentDto confirmDocumentDto
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    ConfirmDocumentRequest.Builder wire = ConfirmDocumentRequest.newBuilder()
      .setObjectPath(confirmDocumentDto.getObjectPath())
      .setTitle(confirmDocumentDto.getTitle())
      .setIsOrganizationWide(
        Boolean.TRUE.equals(confirmDocumentDto.getIsOrganizationWide())
      )
      .addAllDepartmentIds(
        confirmDocumentDto
          .getDepartmentIds()
          .stream()
          .map(Object::toString)
          .toList()
      )
      .setFileName(
        confirmDocumentDto.getFileName() != null
          ? confirmDocumentDto.getFileName()
          : ""
      )
      .addAllOcrLanguages(
        confirmDocumentDto
          .getOcrLanguages()
          .stream()
          .map(ConfirmDocumentDto.OcrLanguagesEnum::getValue)
          .toList()
      );

    DocumentResponse response = withMetadata(context).confirmDocument(
      wire.build()
    );

    return ResponseEntity.status(HttpStatus.CREATED).body(
      ApiResponse.of(201, "Document uploaded", toDto(response))
    );
  }

  @GetMapping(value = "/documents/{id}", produces = { "application/json" })
  @ApiErrors({ "400", "401", "404" })
  public ResponseEntity<
    ApiResponse<DocumentResponseDto>
  > documentsControllerGetV1(@PathVariable("id") String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    DocumentResponse response = withMetadata(context).getDocument(
      DocumentIdRequest.newBuilder().setId(id).build()
    );

    return okDocument(response, "OK", HttpStatus.OK);
  }

  @EvictsCache(CACHE_SCOPE)
  @PatchMapping(
    value = "/documents/{id}",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.DOCUMENT_UPDATE)
  public ResponseEntity<
    ApiResponse<DocumentResponseDto>
  > documentsControllerUpdateV1(
    @PathVariable("id") String id,
    @Valid @RequestBody UpdateDocumentDto updateDocumentDto
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    UpdateDocumentRequest.Builder wire =
      UpdateDocumentRequest.newBuilder().setId(id);
    if (updateDocumentDto.getTitle() != null) {
      wire.setTitle(updateDocumentDto.getTitle());
    }
    if (updateDocumentDto.getIsOrganizationWide() != null) {
      wire.setIsOrganizationWide(updateDocumentDto.getIsOrganizationWide());
    }

    DocumentResponse response = withMetadata(context).updateDocument(
      wire.build()
    );

    return okDocument(response, "Document updated", HttpStatus.OK);
  }

  @EvictsCache(CACHE_SCOPE)
  @DeleteMapping(value = "/documents/{id}", produces = { "application/json" })
  @ApiErrors({ "400", "401", "403", "404" })
  @ResponseStatus(HttpStatus.NO_CONTENT)
  @RequirePermission(PermissionCodesEnum.DOCUMENT_DELETE)
  public ResponseEntity<Void> documentsControllerRemoveV1(
    @PathVariable("id") String id
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    withMetadata(context).deleteDocument(
      DocumentIdRequest.newBuilder().setId(id).build()
    );

    return ResponseEntity.noContent().build();
  }

  @EvictsCache(CACHE_SCOPE)
  @PostMapping(
    value = "/documents/{id}/restore",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.DOCUMENT_DELETE)
  public ResponseEntity<
    ApiResponse<DocumentResponseDto>
  > documentsControllerRestoreV1(@PathVariable("id") String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    DocumentResponse response = withMetadata(context).restoreDocument(
      DocumentIdRequest.newBuilder().setId(id).build()
    );

    return okDocument(response, "Document restored", HttpStatus.OK);
  }

  @EvictsCache(CACHE_SCOPE)
  @PostMapping(
    value = "/documents/{id}/reindex",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @ResponseStatus(HttpStatus.ACCEPTED)
  @RequirePermission(PermissionCodesEnum.DOCUMENT_REINDEX)
  public ResponseEntity<
    ApiResponse<IngestionJobResponseDto>
  > documentsControllerReindexV1(@PathVariable("id") String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    IngestionJobResponse response = withMetadata(context).reindexDocument(
      DocumentIdRequest.newBuilder().setId(id).build()
    );

    return ResponseEntity.status(HttpStatus.ACCEPTED).body(
      ApiResponse.of(202, "Reindex queued", IngestionJobMapper.toDto(response))
    );
  }

  @EvictsCache(CACHE_SCOPE)
  @PostMapping(
    value = "/documents/{id}/replace",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404", "409" })
  @ResponseStatus(HttpStatus.ACCEPTED)
  @RequirePermission(PermissionCodesEnum.DOCUMENT_UPDATE)
  public ResponseEntity<
    ApiResponse<DocumentResponseDto>
  > documentsControllerReplaceV1(
    @PathVariable("id") String id,
    @Valid @RequestBody ReplaceDocumentDto replaceDocumentDto
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    ReplaceDocumentRequest wire = ReplaceDocumentRequest.newBuilder()
      .setId(id)
      .setObjectPath(replaceDocumentDto.getObjectPath())
      .addAllOcrLanguages(
        replaceDocumentDto
          .getOcrLanguages()
          .stream()
          .map(ReplaceDocumentDto.OcrLanguagesEnum::getValue)
          .toList()
      )
      .build();

    DocumentResponse response = withMetadata(context).replaceDocument(wire);

    return okDocument(response, "Replacement queued", HttpStatus.ACCEPTED);
  }

  @GetMapping(
    value = "/documents/{id}/download",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "404" })
  public ResponseEntity<
    ApiResponse<DownloadDocumentResponseDto>
  > documentsControllerDownloadV1(@PathVariable("id") String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    DownloadDocumentResponse response = withMetadata(context).downloadDocument(
      DocumentIdRequest.newBuilder().setId(id).build()
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

  @GetMapping(
    value = "/documents/{id}/ingestion-jobs",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.DOCUMENT_READ)
  public ResponseEntity<
    ApiResponse<PagedData<IngestionJobResponseDto>>
  > documentsControllerListIngestionJobsV1(@PathVariable("id") String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    var response = withMetadata(context).listDocumentIngestionJobs(
      DocumentIdRequest.newBuilder().setId(id).build()
    );

    // A page, as the ingestion-job worklist answers: the RPC returns
    // `{ items, meta }`, and dropping the meta answered a bare list instead.
    PagedData<IngestionJobResponseDto> data = new PagedData<>(
      response.getItemsList().stream().map(IngestionJobMapper::toDto).toList(),
      PageMeta.from(response.getMeta())
    );

    return ResponseEntity.ok(ApiResponse.of(200, "OK", data));
  }

  @GetMapping(
    value = "/documents/{id}/departments",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.DOCUMENT_READ)
  public ResponseEntity<
    ApiResponse<DocumentDepartmentsResponseDto>
  > documentsControllerListDepartmentsV1(@PathVariable("id") String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    ListDocumentDepartmentsResponse response = withMetadata(
      context
    ).listDocumentDepartments(DocumentIdRequest.newBuilder().setId(id).build());

    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "OK",
        new DocumentDepartmentsResponseDto(response.getDepartmentIdsList())
      )
    );
  }

  @EvictsCache(CACHE_SCOPE)
  @PutMapping(
    value = "/documents/{id}/departments",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.DOCUMENT_SHARE)
  public ResponseEntity<
    ApiResponse<DocumentResponseDto>
  > documentsControllerSetDepartmentsV1(
    @PathVariable("id") String id,
    @Valid @RequestBody SetDocumentDepartmentsDto setDocumentDepartmentsDto
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    SetDocumentDepartmentsRequest wire =
      SetDocumentDepartmentsRequest.newBuilder()
        .setId(id)
        .addAllDepartmentIds(
          setDocumentDepartmentsDto
            .getDepartmentIds()
            .stream()
            .map(Object::toString)
            .toList()
        )
        .build();

    // The 409-while-organization-wide rule is enforced entirely in
    // ingestion-service; the gRPC error surfaces through the existing
    // status-to-HTTP mapping, so there is nothing to guard here.
    DocumentResponse response = withMetadata(context).setDocumentDepartments(
      wire
    );

    return okDocument(response, "Document scoping updated", HttpStatus.OK);
  }

  @GetMapping(
    value = "/documents/{id}/chunks",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.DOCUMENT_READ)
  public ResponseEntity<
    ApiResponse<PagedData<DocumentChunkResponseDto>>
  > documentsControllerListChunksV1(
    @PathVariable("id") String id,
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
      defaultValue = "chunkIndex"
    ) DocumentChunkSortField sortBy,
    @Valid @RequestParam(
      value = "sortOrder",
      required = false,
      defaultValue = "ASC"
    ) SortDirection sortOrder
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    PageRequest pageRequest = PageRequest.newBuilder()
      .setPage(page.intValue())
      .setLimit(limit.intValue())
      .setSortBy(sortBy.name())
      .setSortOrder(
        sortOrder == SortDirection.DESC
          ? SortOrder.SORT_ORDER_DESC
          : SortOrder.SORT_ORDER_ASC
      )
      .build();

    ListDocumentChunksResponse response = withMetadata(
      context
    ).listDocumentChunks(
      ListDocumentChunksRequest.newBuilder()
        .setDocumentId(id)
        .setPage(pageRequest)
        .build()
    );

    PagedData<DocumentChunkResponseDto> data = new PagedData<>(
      response
        .getItemsList()
        .stream()
        .map(DocumentsController::toChunkDto)
        .toList(),
      PageMeta.from(response.getMeta())
    );

    return ResponseEntity.ok(ApiResponse.of(200, "OK", data));
  }

  @GetMapping(
    value = "/documents/{id}/chunks/{chunkId}",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "404" })
  public ResponseEntity<
    ApiResponse<DocumentChunkResponseDto>
  > documentsControllerGetChunkV1(
    @PathVariable("id") String id,
    @PathVariable("chunkId") String chunkId
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    DocumentChunkResponse response = withMetadata(context).getDocumentChunk(
      GetDocumentChunkRequest.newBuilder()
        .setDocumentId(id)
        .setChunkId(chunkId)
        .build()
    );

    return ResponseEntity.ok(ApiResponse.of(200, "OK", toChunkDto(response)));
  }

  private ResponseEntity<ApiResponse<DocumentResponseDto>> okDocument(
    DocumentResponse response,
    String message,
    HttpStatus status
  ) {
    return ResponseEntity.status(status).body(
      ApiResponse.of(status.value(), message, toDto(response))
    );
  }

  // ------------------------------------------------------------ mapping

  private static DocumentResponseDto toDto(DocumentResponse document) {
    return new DocumentResponseDto()
      .id(document.getId())
      .organizationId(document.getOrganizationId())
      .createdById(document.getCreatedById())
      .title(document.getTitle())
      .fileUrl(document.getFileUrl())
      .fileType(fileTypeEnumOf(document.getFileType()))
      .ocrLanguages(ocrLanguagesFromWire(document.getOcrLanguagesList()))
      .fileSizeBytes(BigDecimal.valueOf(document.getFileSizeBytes()))
      .isOrganizationWide(document.getIsOrganizationWide())
      .status(
        DocumentResponseDto.StatusEnum.fromValue(
          document.getStatus().name().replace("DOCUMENT_STATUS_", "")
        )
      )
      .departmentIds(new ArrayList<>(document.getDepartmentIdsList()))
      .chunkCount(BigDecimal.valueOf(document.getChunkCount()))
      .createdAt(toOffsetDateTime(document.getCreatedAt()))
      .updatedAt(toOffsetDateTime(document.getUpdatedAt()))
      .deletedAt(
        document.hasDeletedAt()
          ? toOffsetDateTime(document.getDeletedAt())
          : null
      )
      .deletedById(
        document.hasDeletedById() ? document.getDeletedById() : null
      );
  }

  private static DocumentFlagResponseDto toFlagDto(DocumentFlagResponse flag) {
    return new DocumentFlagResponseDto(
      flag.getId(),
      flag.getDocumentId(),
      flag.getDocumentTitle(),
      DocumentFlagResponseDto.FlagTypeEnum.fromValue(
        flag.getFlagType().name().replace("DOCUMENT_FLAG_TYPE_", "")
      ),
      DocumentFlagResponseDto.SeverityEnum.fromValue(
        flag.getSeverity().name().replace("DOCUMENT_FLAG_SEVERITY_", "")
      ),
      flag.getDetail(),
      flag.hasConfidenceScore()
        ? BigDecimal.valueOf(flag.getConfidenceScore())
        : null,
      toOffsetDateTime(flag.getDetectedAt()),
      flag.hasResolvedAt() ? toOffsetDateTime(flag.getResolvedAt()) : null,
      flag.hasResolvedById() ? flag.getResolvedById() : null,
      DocumentFlagResponseDto.ResolutionEnum.fromValue(
        flag.getResolution().name().replace("DOCUMENT_FLAG_RESOLUTION_", "")
      ),
      flag.hasResolutionComment() ? flag.getResolutionComment() : null,
      flag.hasRelatedDocumentId() ? flag.getRelatedDocumentId() : null,
      flag.hasRelatedChunkId() ? flag.getRelatedChunkId() : null
    );
  }

  private static DocumentChunkResponseDto toChunkDto(
    DocumentChunkResponse chunk
  ) {
    return new DocumentChunkResponseDto(
      chunk.getId(),
      chunk.getDocumentId(),
      BigDecimal.valueOf(chunk.getChunkIndex()),
      chunk.getContentText(),
      chunk.hasPageNumber() ? BigDecimal.valueOf(chunk.getPageNumber()) : null,
      BigDecimal.valueOf(chunk.getTokenCount()),
      chunk.hasVectorPointId() ? chunk.getVectorPointId() : null,
      toOffsetDateTime(chunk.getCreatedAt())
    );
  }

  // ------------------------------------------------------------ enum bridges

  /** `bin` rather than a thrown lookup on UNSPECIFIED — the designed-unknown fallback, `?? UNKNOWN_EXTENSION`. */
  private static DocumentResponseDto.FileTypeEnum fileTypeEnumOf(
    DocumentFileType fileType
  ) {
    if (fileType == DocumentFileType.DOCUMENT_FILE_TYPE_UNSPECIFIED) {
      return DocumentResponseDto.FileTypeEnum.BIN;
    }

    return DocumentResponseDto.FileTypeEnum.fromValue(
      fileType.name().replace("DOCUMENT_FILE_TYPE_", "").toLowerCase()
    );
  }

  /** Filters wire codes the enum does not recognise, rather than throwing — `fromValue` throws on a miss. */
  private static List<DocumentResponseDto.OcrLanguagesEnum> ocrLanguagesFromWire(
    List<String> codes
  ) {
    List<DocumentResponseDto.OcrLanguagesEnum> result = new ArrayList<>();
    for (String code : codes) {
      for (DocumentResponseDto.OcrLanguagesEnum candidate : DocumentResponseDto.OcrLanguagesEnum.values()) {
        if (candidate.getValue().equals(code)) {
          result.add(candidate);
          break;
        }
      }
    }

    return result;
  }

  private static DocumentStatus documentStatusOf(String status) {
    return DocumentStatus.valueOf("DOCUMENT_STATUS_" + status);
  }

  /** Lower-cased first, matching `ListDocumentsQueryDto.fileType`'s own `@Transform(lowerIfString)`. */
  private static DocumentFileType documentFileTypeOf(String fileType) {
    return DocumentFileType.valueOf(
      "DOCUMENT_FILE_TYPE_" + fileType.toUpperCase()
    );
  }

  private static DocumentFlagType documentFlagTypeOf(String type) {
    return DocumentFlagType.valueOf("DOCUMENT_FLAG_TYPE_" + type);
  }

  private static DocumentFlagSeverity documentFlagSeverityOf(String severity) {
    return DocumentFlagSeverity.valueOf("DOCUMENT_FLAG_SEVERITY_" + severity);
  }

  private static OffsetDateTime toOffsetDateTime(
    com.google.protobuf.Timestamp timestamp
  ) {
    return Instant.ofEpochSecond(
      timestamp.getSeconds(),
      timestamp.getNanos()
    ).atOffset(ZoneOffset.UTC);
  }

  /**
   * sha256 of the sorted department set (or the literal `super-admin`),
   * truncated to 16 hex characters — callers who see the same departments
   * share one cache entry; callers who see different ones never do.
   */
  private static String visibilityDigest(RequestContext context) {
    String material = context.isSuperAdmin()
      ? "super-admin"
      : context
          .departmentIds()
          .stream()
          .sorted()
          .reduce((a, b) -> a + "," + b)
          .orElse("");

    try {
      MessageDigest sha256 = MessageDigest.getInstance("SHA-256");
      byte[] hash = sha256.digest(
        material.getBytes(java.nio.charset.StandardCharsets.UTF_8)
      );

      return HexFormat.of().formatHex(hash, 0, 8);
    } catch (NoSuchAlgorithmException impossible) {
      throw new IllegalStateException(impossible);
    }
  }
}
