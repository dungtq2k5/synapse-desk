package com.synapsedesk.gateway.modules.ingestionjobs;

import com.synapsedesk.gateway.common.auth.CurrentRequest;
import com.synapsedesk.gateway.common.auth.CurrentUser;
import com.synapsedesk.gateway.common.auth.RequestContext;
import com.synapsedesk.gateway.common.dto.CurrentUserResponseDto.PermissionCodesEnum;
import com.synapsedesk.gateway.common.grpc.CallerMetadata;
import com.synapsedesk.gateway.common.security.RequirePermission;
import com.synapsedesk.gateway.modules.documents.dto.graphql.DocumentGqlDto;
import com.synapsedesk.gateway.modules.ingestionjobs.IngestionJobMapper;
import com.synapsedesk.gateway.modules.ingestionjobs.dto.graphql.IngestionJobGqlDto;
import com.synapsedesk.gateway.modules.ingestionjobs.dto.graphql.IngestionJobPageGqlDto;
import com.synapsedesk.gateway.modules.ingestionjobs.dto.graphql.IngestionJobStatusGql;
import io.grpc.StatusRuntimeException;
import io.grpc.stub.MetadataUtils;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.dataloader.DataLoader;
import org.springframework.graphql.data.method.annotation.Argument;
import org.springframework.graphql.data.method.annotation.QueryMapping;
import org.springframework.graphql.data.method.annotation.SchemaMapping;
import org.springframework.stereotype.Controller;
import synapsedesk.auth.Common.PageRequest;
import synapsedesk.auth.Common.SortOrder;
import synapsedesk.ingestion.Document.IngestionJobIdRequest;
import synapsedesk.ingestion.Document.IngestionJobResponse;
import synapsedesk.ingestion.Document.IngestionJobStatus;
import synapsedesk.ingestion.Document.ListIngestionJobsRequest;
import synapsedesk.ingestion.Document.ListIngestionJobsResponse;
import synapsedesk.ingestion.DocumentServiceGrpc;

/** `Query.ingestionJob`, `Query.ingestionJobs`, and the `document` edge. */
@Controller
public class IngestionJobsResolver {

  private static final long DEADLINE_SECONDS = 5;

  private final DocumentServiceGrpc.DocumentServiceBlockingStub stub;
  private final CurrentUser currentUser;

  public IngestionJobsResolver(
    DocumentServiceGrpc.DocumentServiceBlockingStub stub,
    CurrentUser currentUser
  ) {
    this.stub = stub;
    this.currentUser = currentUser;
  }

  @QueryMapping
  @RequirePermission(PermissionCodesEnum.DOCUMENT_READ)
  public IngestionJobGqlDto ingestionJob(@Argument String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    try {
      IngestionJobResponse response = withMetadata(context).getIngestionJob(
        IngestionJobIdRequest.newBuilder().setId(id).build()
      );

      return IngestionJobMapper.toIngestionJobGqlDto(response);
    } catch (StatusRuntimeException notFoundOrForbidden) {
      // Indistinguishable from a job on a document the caller cannot see —
      // ADR 0037, matching `Query.ingestionJob`'s own schema description.
      return null;
    }
  }

  @QueryMapping(name = "ingestionJobs")
  @RequirePermission(PermissionCodesEnum.DOCUMENT_READ)
  public IngestionJobPageGqlDto ingestionJobs(
    @Argument String documentId,
    @Argument int first,
    @Argument int page,
    @Argument IngestionJobStatusGql status
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    PageRequest pageRequest = PageRequest.newBuilder()
      .setPage(page)
      .setLimit(first)
      .setSortOrder(SortOrder.SORT_ORDER_DESC)
      .build();

    ListIngestionJobsRequest.Builder wire =
      ListIngestionJobsRequest.newBuilder().setPage(pageRequest);
    if (documentId != null) {
      wire.setDocumentId(documentId);
    }
    if (status != null) {
      wire.setStatus(
        IngestionJobStatus.valueOf("INGESTION_JOB_STATUS_" + status.name())
      );
    }

    ListIngestionJobsResponse response = withMetadata(
      context
    ).listIngestionJobs(wire.build());

    var meta = response.getMeta();

    return new IngestionJobPageGqlDto(
      response
        .getItemsList()
        .stream()
        .map(IngestionJobMapper::toIngestionJobGqlDto)
        .toList(),
      new com.synapsedesk.gateway.common.graphql.PageMetaGqlDto(
        meta.getTotalItems(),
        meta.getItemCount(),
        meta.getItemsPerPage(),
        meta.getTotalPages(),
        meta.getCurrentPage()
      )
    );
  }

  /** `IngestionJob.document` — what this job is ingesting. */
  @SchemaMapping(typeName = "IngestionJob", field = "document")
  public CompletableFuture<DocumentGqlDto> document(
    IngestionJobGqlDto job,
    DataLoader<String, DocumentGqlDto> loader
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    return loader.load(job.documentId(), context);
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
