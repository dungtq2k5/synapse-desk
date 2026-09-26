package com.synapsedesk.gateway.documents;

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

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import com.synapsedesk.gateway.auth.CurrentRequest;
import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.cache.CacheService;
import com.synapsedesk.gateway.generated.api.DocumentsApi;
import com.synapsedesk.gateway.generated.model.AuthControllerForgotPasswordV1202Response;
import com.synapsedesk.gateway.generated.model.ConfirmDocumentDto;
import com.synapsedesk.gateway.generated.model.CurrentUserResponseDto.PermissionCodesEnum;
import com.synapsedesk.gateway.generated.model.DocumentChunkResponseDto;
import com.synapsedesk.gateway.generated.model.DocumentDepartmentsResponseDto;
import com.synapsedesk.gateway.generated.model.DocumentFlagResponseDto;
import com.synapsedesk.gateway.generated.model.DocumentResponseDto;
import com.synapsedesk.gateway.generated.model.DocumentsControllerConfirmV1201Response;
import com.synapsedesk.gateway.generated.model.DocumentsControllerDownloadV1200Response;
import com.synapsedesk.gateway.generated.model.DocumentsControllerGetChunkV1200Response;
import com.synapsedesk.gateway.generated.model.DocumentsControllerGetFlagV1200Response;
import com.synapsedesk.gateway.generated.model.DocumentsControllerListChunksV1200Response;
import com.synapsedesk.gateway.generated.model.DocumentsControllerListChunksV1200ResponseData;
import com.synapsedesk.gateway.generated.model.DocumentsControllerListDepartmentsV1200Response;
import com.synapsedesk.gateway.generated.model.DocumentsControllerListFlagsV1200Response;
import com.synapsedesk.gateway.generated.model.DocumentsControllerListFlagsV1200ResponseData;
import com.synapsedesk.gateway.generated.model.DocumentsControllerListIngestionJobsV1200Response;
import com.synapsedesk.gateway.generated.model.DocumentsControllerListIngestionJobsV1200ResponseData;
import com.synapsedesk.gateway.generated.model.DocumentsControllerListV1200Response;
import com.synapsedesk.gateway.generated.model.DocumentsControllerListV1200ResponseData;
import com.synapsedesk.gateway.generated.model.DocumentsControllerPresignV1200Response;
import com.synapsedesk.gateway.generated.model.DocumentsControllerReindexV1202Response;
import com.synapsedesk.gateway.generated.model.DocumentsControllerStorageUsageV1200Response;
import com.synapsedesk.gateway.generated.model.IngestionJobResponseDto;
import com.synapsedesk.gateway.generated.model.InvitationsControllerListV1200ResponseDataMeta;
import com.synapsedesk.gateway.generated.model.PresignDocumentDto;
import com.synapsedesk.gateway.generated.model.ReplaceDocumentDto;
import com.synapsedesk.gateway.generated.model.ResolveDocumentFlagDto;
import com.synapsedesk.gateway.generated.model.SetDocumentDepartmentsDto;
import com.synapsedesk.gateway.generated.model.StorageUsageResponseDto;
import com.synapsedesk.gateway.generated.model.UpdateDocumentDto;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import com.synapsedesk.gateway.security.RequirePermission;

import io.grpc.stub.MetadataUtils;
import synapsedesk.auth.Common.PageMeta;
import synapsedesk.auth.Common.PageRequest;
import synapsedesk.auth.Common.SortOrder;
import synapsedesk.ingestion.Document.ConfirmDocumentRequest;
import synapsedesk.ingestion.Document.DocumentChunkResponse;
import synapsedesk.ingestion.Document.DocumentFlagResolution;
import synapsedesk.ingestion.Document.DocumentFlagResponse;
import synapsedesk.ingestion.Document.DocumentFlagSeverity;
import synapsedesk.ingestion.Document.DocumentFlagType;
import synapsedesk.ingestion.Document.DocumentFileType;
import synapsedesk.ingestion.Document.DocumentIdRequest;
import synapsedesk.ingestion.Document.DocumentResponse;
import synapsedesk.ingestion.Document.DocumentStatus;
import synapsedesk.ingestion.Document.DocumentFlagIdRequest;
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
 * `DocumentService` (`documents-grpc.client.ts` reproduced). New stub
 * (`documentServiceStub`) on the EXISTING `ingestionServiceChannel` — the
 * gateway never speaks to storage-service directly; ingestion-service does,
 * which is what makes presign/confirm/replace ordinary RPC forwards here.
 *
 * <p><b>`list` is the one cached route.</b> Node's `@Cacheable` is a global
 * interceptor keyed on the RAW query string plus a visibility digest of the
 * caller's departments (`cacheable.interceptor.ts`); this reproduces both the
 * key shape and the cached VALUE (the full envelope, not just the DTO — that
 * is what Node's interceptor actually stores) so the two implementations'
 * entries stay interchangeable. The key is built from the request's raw query
 * parameters, not the bound/defaulted method arguments — Node's key comes from
 * `request.query` before any default-filling, so keying off Java's
 * already-defaulted parameters would produce a different key for the same
 * logical request whenever a client omits a param.
 */
@RestController
public class DocumentsController implements DocumentsApi {

  private static final long DEADLINE_SECONDS = 5;
  private static final String CACHE_SCOPE = "documents";
  private static final long LIST_CACHE_TTL_SECONDS = 60;

  private final DocumentServiceGrpc.DocumentServiceBlockingStub stub;
  private final CurrentUser currentUser;
  private final CacheService cache;

  public DocumentsController(
      DocumentServiceGrpc.DocumentServiceBlockingStub stub, CurrentUser currentUser, CacheService cache) {
    this.stub = stub;
    this.currentUser = currentUser;
    this.cache = cache;
  }

  private DocumentServiceGrpc.DocumentServiceBlockingStub withMetadata(RequestContext context) {
    return stub.withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
        .withInterceptors(MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context)));
  }

  @Override
  public ResponseEntity<DocumentsControllerListV1200Response> documentsControllerListV1(
      BigDecimal page,
      BigDecimal limit,
      String sortBy,
      String sortOrder,
      String searchTerm,
      Boolean includeDeleted,
      String status,
      UUID departmentId,
      String fileType) {
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

    String key = cache.buildKey(context.organizationId(), CACHE_SCOPE, rawParams);

    DocumentsControllerListV1200Response envelope =
        cache.wrap(
            key,
            LIST_CACHE_TTL_SECONDS,
            DocumentsControllerListV1200Response.class,
            () -> {
              PageRequest.Builder pageRequest =
                  PageRequest.newBuilder()
                      .setPage(page.intValue())
                      .setLimit(limit.intValue())
                      .setSortBy(sortBy)
                      .setSortOrder(
                          "DESC".equalsIgnoreCase(sortOrder) ? SortOrder.SORT_ORDER_DESC : SortOrder.SORT_ORDER_ASC);
              if (searchTerm != null) {
                pageRequest.setSearchTerm(searchTerm);
              }

              ListDocumentsRequest.Builder wire = ListDocumentsRequest.newBuilder().setPage(pageRequest);
              if (departmentId != null) {
                wire.setDepartmentId(departmentId.toString());
              }
              if (status != null) {
                wire.setStatus(documentStatusOf(status));
              }
              if (fileType != null) {
                wire.setFileType(documentFileTypeOf(fileType));
              }
              if (includeDeleted != null) {
                wire.setIncludeDeleted(includeDeleted);
              }

              ListDocumentsResponse response = withMetadata(context).listDocuments(wire.build());

              DocumentsControllerListV1200ResponseData data =
                  new DocumentsControllerListV1200ResponseData()
                      .items(response.getItemsList().stream().map(DocumentsController::toDto).toList())
                      .meta(toMetaDto(response.getMeta()));

              return new DocumentsControllerListV1200Response()
                  .success(true)
                  .statusCode(BigDecimal.valueOf(200))
                  .message("OK")
                  .data(data);
            });

    return ResponseEntity.ok(envelope);
  }

  @Override
  @RequirePermission(PermissionCodesEnum.DOCUMENT_READ)
  public ResponseEntity<DocumentsControllerStorageUsageV1200Response> documentsControllerStorageUsageV1() {
    RequestContext context = currentUser.require(CurrentRequest.request());

    // Blank id, ignored server-side — a workspace total, not a per-document one.
    StorageUsageResponse response =
        withMetadata(context).getStorageUsage(DocumentIdRequest.newBuilder().setId("").build());

    return ResponseEntity.ok(
        new DocumentsControllerStorageUsageV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(
                new StorageUsageResponseDto(
                    BigDecimal.valueOf(response.getUsedBytes()),
                    BigDecimal.valueOf(response.getLimitBytes()),
                    BigDecimal.valueOf(response.getDocumentCount()))));
  }

  @Override
  @RequirePermission(PermissionCodesEnum.DOCUMENT_READ)
  public ResponseEntity<DocumentsControllerListFlagsV1200Response> documentsControllerListFlagsV1(
      BigDecimal page,
      BigDecimal limit,
      String sortBy,
      String sortOrder,
      List<String> type,
      Boolean includeResolved,
      String severity,
      UUID documentId) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    PageRequest pageRequest =
        PageRequest.newBuilder()
            .setPage(page.intValue())
            .setLimit(limit.intValue())
            .setSortBy(sortBy)
            .setSortOrder("DESC".equalsIgnoreCase(sortOrder) ? SortOrder.SORT_ORDER_DESC : SortOrder.SORT_ORDER_ASC)
            .build();

    ListDocumentFlagsRequest.Builder wire = ListDocumentFlagsRequest.newBuilder().setPage(pageRequest);
    if (type != null) {
      type.forEach(t -> wire.addFlagTypes(documentFlagTypeOf(t)));
    }
    if (severity != null) {
      wire.setSeverity(documentFlagSeverityOf(severity));
    }
    if (documentId != null) {
      wire.setDocumentId(documentId.toString());
    }
    if (includeResolved != null) {
      wire.setIncludeResolved(includeResolved);
    }

    ListDocumentFlagsResponse response = withMetadata(context).listDocumentFlags(wire.build());

    DocumentsControllerListFlagsV1200ResponseData data =
        new DocumentsControllerListFlagsV1200ResponseData()
            .items(response.getItemsList().stream().map(DocumentsController::toFlagDto).toList())
            .meta(toMetaDto(response.getMeta()));

    return ResponseEntity.ok(
        new DocumentsControllerListFlagsV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(data));
  }

  @Override
  @RequirePermission(PermissionCodesEnum.DOCUMENT_READ)
  public ResponseEntity<DocumentsControllerGetFlagV1200Response> documentsControllerGetFlagV1(String flagId) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    DocumentFlagResponse response =
        withMetadata(context).getDocumentFlag(DocumentFlagIdRequest.newBuilder().setId(flagId).build());

    return okFlag(response, "OK");
  }

  @Override
  @RequirePermission(PermissionCodesEnum.DOCUMENT_UPDATE)
  public ResponseEntity<DocumentsControllerGetFlagV1200Response> documentsControllerDismissFlagV1(
      String flagId, ResolveDocumentFlagDto resolveDocumentFlagDto) {
    return resolveFlag(
        flagId, DocumentFlagResolution.DOCUMENT_FLAG_RESOLUTION_DISMISSED, resolveDocumentFlagDto, "Flag dismissed");
  }

  @Override
  @RequirePermission(PermissionCodesEnum.DOCUMENT_UPDATE)
  public ResponseEntity<DocumentsControllerGetFlagV1200Response> documentsControllerFixFlagV1(
      String flagId, ResolveDocumentFlagDto resolveDocumentFlagDto) {
    return resolveFlag(
        flagId, DocumentFlagResolution.DOCUMENT_FLAG_RESOLUTION_FIXED, resolveDocumentFlagDto, "Flag marked fixed");
  }

  @Override
  @RequirePermission(PermissionCodesEnum.DOCUMENT_UPDATE)
  public ResponseEntity<DocumentsControllerGetFlagV1200Response> documentsControllerReplaceFlagV1(
      String flagId, ResolveDocumentFlagDto resolveDocumentFlagDto) {
    return resolveFlag(
        flagId,
        DocumentFlagResolution.DOCUMENT_FLAG_RESOLUTION_DOCUMENT_REPLACED,
        resolveDocumentFlagDto,
        "Flag marked replaced");
  }

  private ResponseEntity<DocumentsControllerGetFlagV1200Response> resolveFlag(
      String flagId, DocumentFlagResolution resolution, ResolveDocumentFlagDto dto, String message) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    ResolveDocumentFlagRequest.Builder wire =
        ResolveDocumentFlagRequest.newBuilder().setId(flagId).setResolution(resolution);
    if (dto.getComment() != null) {
      wire.setComment(dto.getComment());
    }

    DocumentFlagResponse response = withMetadata(context).resolveDocumentFlag(wire.build());

    return okFlag(response, message);
  }

  private ResponseEntity<DocumentsControllerGetFlagV1200Response> okFlag(DocumentFlagResponse response, String message) {
    return ResponseEntity.ok(
        new DocumentsControllerGetFlagV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message(message)
            .data(toFlagDto(response)));
  }

  @Override
  @RequirePermission(PermissionCodesEnum.DOCUMENT_DELETE)
  public ResponseEntity<AuthControllerForgotPasswordV1202Response> documentsControllerDeleteFlagV1(String flagId) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    // `deleted` is discarded: the only false it could carry is a failure, and a
    // failure arrives as an exception.
    withMetadata(context).deleteDocumentFlag(DocumentFlagIdRequest.newBuilder().setId(flagId).build());

    return ResponseEntity.noContent().build();
  }

  @Override
  @RequirePermission(PermissionCodesEnum.DOCUMENT_CREATE)
  public ResponseEntity<DocumentsControllerPresignV1200Response> documentsControllerPresignV1(
      PresignDocumentDto presignDocumentDto) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    PresignDocumentResponse response =
        withMetadata(context)
            .presignDocument(
                PresignDocumentRequest.newBuilder()
                    .setContentType(presignDocumentDto.getContentType().getValue())
                    .setSizeBytes(presignDocumentDto.getSizeBytes().longValue())
                    .setFileName(presignDocumentDto.getFileName())
                    .build());

    return ResponseEntity.ok(
        new DocumentsControllerPresignV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(
                new com.synapsedesk.gateway.generated.model.PresignDocumentResponseDto(
                    response.getUploadUrl(), response.getObjectPath(), toOffsetDateTime(response.getExpiresAt()))));
  }

  @Override
  @RequirePermission(PermissionCodesEnum.DOCUMENT_CREATE)
  public ResponseEntity<DocumentsControllerConfirmV1201Response> documentsControllerConfirmV1(
      ConfirmDocumentDto confirmDocumentDto) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    ConfirmDocumentRequest.Builder wire =
        ConfirmDocumentRequest.newBuilder()
            .setObjectPath(confirmDocumentDto.getObjectPath())
            .setTitle(confirmDocumentDto.getTitle())
            .setIsOrganizationWide(Boolean.TRUE.equals(confirmDocumentDto.getIsOrganizationWide()))
            .addAllDepartmentIds(confirmDocumentDto.getDepartmentIds().stream().map(Object::toString).toList())
            .setFileName(confirmDocumentDto.getFileName() != null ? confirmDocumentDto.getFileName() : "")
            .addAllOcrLanguages(
                confirmDocumentDto.getOcrLanguages().stream()
                    .map(ConfirmDocumentDto.OcrLanguagesEnum::getValue)
                    .toList());

    DocumentResponse response = withMetadata(context).confirmDocument(wire.build());

    return ResponseEntity.status(HttpStatus.CREATED)
        .body(
            new DocumentsControllerConfirmV1201Response()
                .success(true)
                .statusCode(BigDecimal.valueOf(201))
                .message("Document uploaded")
                .data(toDto(response)));
  }

  @Override
  public ResponseEntity<DocumentsControllerConfirmV1201Response> documentsControllerGetV1(String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    DocumentResponse response =
        withMetadata(context).getDocument(DocumentIdRequest.newBuilder().setId(id).build());

    return okDocument(response, "OK", HttpStatus.OK);
  }

  @Override
  @RequirePermission(PermissionCodesEnum.DOCUMENT_UPDATE)
  public ResponseEntity<DocumentsControllerConfirmV1201Response> documentsControllerUpdateV1(
      String id, UpdateDocumentDto updateDocumentDto) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    UpdateDocumentRequest.Builder wire = UpdateDocumentRequest.newBuilder().setId(id);
    if (updateDocumentDto.getTitle() != null) {
      wire.setTitle(updateDocumentDto.getTitle());
    }
    if (updateDocumentDto.getIsOrganizationWide() != null) {
      wire.setIsOrganizationWide(updateDocumentDto.getIsOrganizationWide());
    }

    DocumentResponse response = withMetadata(context).updateDocument(wire.build());

    return okDocument(response, "Document updated", HttpStatus.OK);
  }

  @Override
  @RequirePermission(PermissionCodesEnum.DOCUMENT_DELETE)
  public ResponseEntity<AuthControllerForgotPasswordV1202Response> documentsControllerRemoveV1(String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    withMetadata(context).deleteDocument(DocumentIdRequest.newBuilder().setId(id).build());

    return ResponseEntity.noContent().build();
  }

  @Override
  @RequirePermission(PermissionCodesEnum.DOCUMENT_DELETE)
  public ResponseEntity<DocumentsControllerConfirmV1201Response> documentsControllerRestoreV1(String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    DocumentResponse response =
        withMetadata(context).restoreDocument(DocumentIdRequest.newBuilder().setId(id).build());

    return okDocument(response, "Document restored", HttpStatus.OK);
  }

  @Override
  @RequirePermission(PermissionCodesEnum.DOCUMENT_REINDEX)
  public ResponseEntity<DocumentsControllerReindexV1202Response> documentsControllerReindexV1(String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    IngestionJobResponse response =
        withMetadata(context).reindexDocument(DocumentIdRequest.newBuilder().setId(id).build());

    return ResponseEntity.status(HttpStatus.ACCEPTED)
        .body(
            new DocumentsControllerReindexV1202Response()
                .success(true)
                .statusCode(BigDecimal.valueOf(202))
                .message("Reindex queued")
                .data(toIngestionJobDto(response)));
  }

  @Override
  @RequirePermission(PermissionCodesEnum.DOCUMENT_UPDATE)
  public ResponseEntity<DocumentsControllerConfirmV1201Response> documentsControllerReplaceV1(
      String id, ReplaceDocumentDto replaceDocumentDto) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    ReplaceDocumentRequest wire =
        ReplaceDocumentRequest.newBuilder()
            .setId(id)
            .setObjectPath(replaceDocumentDto.getObjectPath())
            .addAllOcrLanguages(
                replaceDocumentDto.getOcrLanguages().stream()
                    .map(ReplaceDocumentDto.OcrLanguagesEnum::getValue)
                    .toList())
            .build();

    DocumentResponse response = withMetadata(context).replaceDocument(wire);

    return okDocument(response, "Replacement queued", HttpStatus.ACCEPTED);
  }

  @Override
  public ResponseEntity<DocumentsControllerDownloadV1200Response> documentsControllerDownloadV1(String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    DownloadDocumentResponse response =
        withMetadata(context).downloadDocument(DocumentIdRequest.newBuilder().setId(id).build());

    return ResponseEntity.ok(
        new DocumentsControllerDownloadV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(
                new com.synapsedesk.gateway.generated.model.DownloadDocumentResponseDto(
                    response.getDownloadUrl(), toOffsetDateTime(response.getExpiresAt()))));
  }

  @Override
  @RequirePermission(PermissionCodesEnum.DOCUMENT_READ)
  public ResponseEntity<DocumentsControllerListIngestionJobsV1200Response> documentsControllerListIngestionJobsV1(
      String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    var response =
        withMetadata(context).listDocumentIngestionJobs(DocumentIdRequest.newBuilder().setId(id).build());

    DocumentsControllerListIngestionJobsV1200ResponseData data =
        new DocumentsControllerListIngestionJobsV1200ResponseData()
            .items(response.getItemsList().stream().map(DocumentsController::toIngestionJobDto).toList())
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
  public ResponseEntity<DocumentsControllerListDepartmentsV1200Response> documentsControllerListDepartmentsV1(
      String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    ListDocumentDepartmentsResponse response =
        withMetadata(context).listDocumentDepartments(DocumentIdRequest.newBuilder().setId(id).build());

    return ResponseEntity.ok(
        new DocumentsControllerListDepartmentsV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(new DocumentDepartmentsResponseDto(response.getDepartmentIdsList())));
  }

  @Override
  @RequirePermission(PermissionCodesEnum.DOCUMENT_SHARE)
  public ResponseEntity<DocumentsControllerConfirmV1201Response> documentsControllerSetDepartmentsV1(
      String id, SetDocumentDepartmentsDto setDocumentDepartmentsDto) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    SetDocumentDepartmentsRequest wire =
        SetDocumentDepartmentsRequest.newBuilder()
            .setId(id)
            .addAllDepartmentIds(setDocumentDepartmentsDto.getDepartmentIds().stream().map(Object::toString).toList())
            .build();

    // The 409-while-organization-wide rule is enforced entirely in
    // ingestion-service; the gRPC error surfaces through the existing
    // status-to-HTTP mapping, so there is nothing to guard here.
    DocumentResponse response = withMetadata(context).setDocumentDepartments(wire);

    return okDocument(response, "Document scoping updated", HttpStatus.OK);
  }

  @Override
  @RequirePermission(PermissionCodesEnum.DOCUMENT_READ)
  public ResponseEntity<DocumentsControllerListChunksV1200Response> documentsControllerListChunksV1(
      String id,
      BigDecimal page,
      BigDecimal limit,
      String sortBy,
      String sortOrder,
      String searchTerm,
      Boolean includeDeleted,
      String status,
      UUID departmentId,
      String fileType) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    // Only page/limit are meaningful for chunks — Node reuses the whole
    // documents list query DTO for this route's pagination and forwards
    // nothing else.
    PageRequest pageRequest =
        PageRequest.newBuilder()
            .setPage(page.intValue())
            .setLimit(limit.intValue())
            .setSortBy(sortBy)
            .setSortOrder("DESC".equalsIgnoreCase(sortOrder) ? SortOrder.SORT_ORDER_DESC : SortOrder.SORT_ORDER_ASC)
            .build();

    ListDocumentChunksResponse response =
        withMetadata(context)
            .listDocumentChunks(
                ListDocumentChunksRequest.newBuilder().setDocumentId(id).setPage(pageRequest).build());

    DocumentsControllerListChunksV1200ResponseData data =
        new com.synapsedesk.gateway.generated.model.DocumentsControllerListChunksV1200ResponseData()
            .items(response.getItemsList().stream().map(DocumentsController::toChunkDto).toList())
            .meta(toMetaDto(response.getMeta()));

    return ResponseEntity.ok(
        new DocumentsControllerListChunksV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(data));
  }

  @Override
  public ResponseEntity<DocumentsControllerGetChunkV1200Response> documentsControllerGetChunkV1(
      String id, String chunkId) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    DocumentChunkResponse response =
        withMetadata(context)
            .getDocumentChunk(
                GetDocumentChunkRequest.newBuilder().setDocumentId(id).setChunkId(chunkId).build());

    return ResponseEntity.ok(
        new DocumentsControllerGetChunkV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(toChunkDto(response)));
  }

  private ResponseEntity<DocumentsControllerConfirmV1201Response> okDocument(
      DocumentResponse response, String message, HttpStatus status) {
    return ResponseEntity.status(status)
        .body(
            new DocumentsControllerConfirmV1201Response()
                .success(true)
                .statusCode(BigDecimal.valueOf(status.value()))
                .message(message)
                .data(toDto(response)));
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
        .status(DocumentResponseDto.StatusEnum.fromValue(document.getStatus().name().replace("DOCUMENT_STATUS_", "")))
        .departmentIds(new ArrayList<>(document.getDepartmentIdsList()))
        .chunkCount(BigDecimal.valueOf(document.getChunkCount()))
        .createdAt(toOffsetDateTime(document.getCreatedAt()))
        .updatedAt(toOffsetDateTime(document.getUpdatedAt()))
        .deletedAt(document.hasDeletedAt() ? toOffsetDateTime(document.getDeletedAt()) : null)
        .deletedById(document.hasDeletedById() ? document.getDeletedById() : null);
  }

  private static DocumentFlagResponseDto toFlagDto(DocumentFlagResponse flag) {
    return new DocumentFlagResponseDto(
        flag.getId(),
        flag.getDocumentId(),
        flag.getDocumentTitle(),
        DocumentFlagResponseDto.FlagTypeEnum.fromValue(flag.getFlagType().name().replace("DOCUMENT_FLAG_TYPE_", "")),
        DocumentFlagResponseDto.SeverityEnum.fromValue(
            flag.getSeverity().name().replace("DOCUMENT_FLAG_SEVERITY_", "")),
        flag.getDetail(),
        flag.hasConfidenceScore() ? BigDecimal.valueOf(flag.getConfidenceScore()) : null,
        toOffsetDateTime(flag.getDetectedAt()),
        flag.hasResolvedAt() ? toOffsetDateTime(flag.getResolvedAt()) : null,
        flag.hasResolvedById() ? flag.getResolvedById() : null,
        DocumentFlagResponseDto.ResolutionEnum.fromValue(
            flag.getResolution().name().replace("DOCUMENT_FLAG_RESOLUTION_", "")),
        flag.hasResolutionComment() ? flag.getResolutionComment() : null,
        flag.hasRelatedDocumentId() ? flag.getRelatedDocumentId() : null,
        flag.hasRelatedChunkId() ? flag.getRelatedChunkId() : null);
  }

  private static DocumentChunkResponseDto toChunkDto(DocumentChunkResponse chunk) {
    return new DocumentChunkResponseDto(
        chunk.getId(),
        chunk.getDocumentId(),
        BigDecimal.valueOf(chunk.getChunkIndex()),
        chunk.getContentText(),
        chunk.hasPageNumber() ? BigDecimal.valueOf(chunk.getPageNumber()) : null,
        BigDecimal.valueOf(chunk.getTokenCount()),
        chunk.hasVectorPointId() ? chunk.getVectorPointId() : null,
        toOffsetDateTime(chunk.getCreatedAt()));
  }

  private static IngestionJobResponseDto toIngestionJobDto(IngestionJobResponse job) {
    return new IngestionJobResponseDto(
        job.getId(),
        job.getDocumentId(),
        job.getBullmqJobId(),
        IngestionJobResponseDto.StatusEnum.fromValue(
            job.getStatus().name().replace("INGESTION_JOB_STATUS_", "")),
        job.getErrorLog(),
        job.hasProcessedAt() ? toOffsetDateTime(job.getProcessedAt()) : null,
        toOffsetDateTime(job.getCreatedAt()));
  }

  private static InvitationsControllerListV1200ResponseDataMeta toMetaDto(PageMeta meta) {
    return new InvitationsControllerListV1200ResponseDataMeta(
        BigDecimal.valueOf(meta.getTotalItems()),
        BigDecimal.valueOf(meta.getItemCount()),
        BigDecimal.valueOf(meta.getItemsPerPage()),
        BigDecimal.valueOf(meta.getTotalPages()),
        BigDecimal.valueOf(meta.getCurrentPage()));
  }

  // ------------------------------------------------------------ enum bridges

  /** `bin` rather than a thrown lookup on UNSPECIFIED — the designed-unknown fallback, `?? UNKNOWN_EXTENSION`. */
  private static DocumentResponseDto.FileTypeEnum fileTypeEnumOf(DocumentFileType fileType) {
    if (fileType == DocumentFileType.DOCUMENT_FILE_TYPE_UNSPECIFIED) {
      return DocumentResponseDto.FileTypeEnum.BIN;
    }

    return DocumentResponseDto.FileTypeEnum.fromValue(
        fileType.name().replace("DOCUMENT_FILE_TYPE_", "").toLowerCase());
  }

  /** Filters wire codes the enum does not recognise, rather than throwing — `fromValue` throws on a miss. */
  private static List<DocumentResponseDto.OcrLanguagesEnum> ocrLanguagesFromWire(List<String> codes) {
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
    return DocumentFileType.valueOf("DOCUMENT_FILE_TYPE_" + fileType.toUpperCase());
  }

  private static DocumentFlagType documentFlagTypeOf(String type) {
    return DocumentFlagType.valueOf("DOCUMENT_FLAG_TYPE_" + type);
  }

  private static DocumentFlagSeverity documentFlagSeverityOf(String severity) {
    return DocumentFlagSeverity.valueOf("DOCUMENT_FLAG_SEVERITY_" + severity);
  }

  private static OffsetDateTime toOffsetDateTime(com.google.protobuf.Timestamp timestamp) {
    return Instant.ofEpochSecond(timestamp.getSeconds(), timestamp.getNanos()).atOffset(ZoneOffset.UTC);
  }

  /**
   * `visibilityDigest`, reproduced: sha256 of the sorted department set (or the
   * literal `super-admin`), truncated to 16 hex characters — must mirror
   * `cacheable.interceptor.ts` exactly, or a Java-written entry and a
   * Node-written entry for the same caller land under different keys.
   */
  private static String visibilityDigest(RequestContext context) {
    String material =
        context.isSuperAdmin()
            ? "super-admin"
            : context.departmentIds().stream().sorted().reduce((a, b) -> a + "," + b).orElse("");

    try {
      MessageDigest sha256 = MessageDigest.getInstance("SHA-256");
      byte[] hash = sha256.digest(material.getBytes(java.nio.charset.StandardCharsets.UTF_8));

      return HexFormat.of().formatHex(hash, 0, 8);
    } catch (NoSuchAlgorithmException impossible) {
      throw new IllegalStateException(impossible);
    }
  }
}
