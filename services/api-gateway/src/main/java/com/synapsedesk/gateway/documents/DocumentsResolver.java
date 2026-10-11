package com.synapsedesk.gateway.documents;

import com.synapsedesk.gateway.common.auth.CurrentRequest;
import com.synapsedesk.gateway.common.auth.CurrentUser;
import com.synapsedesk.gateway.common.auth.RequestContext;
import com.synapsedesk.gateway.common.graphql.GraphqlLimits;
import com.synapsedesk.gateway.common.graphql.UserSummaryGqlDto;
import com.synapsedesk.gateway.common.grpc.CallerMetadata;
import com.synapsedesk.gateway.common.security.RequirePermission;
import com.synapsedesk.gateway.departments.DepartmentGqlDto;
import com.synapsedesk.gateway.model.CurrentUserResponseDto.PermissionCodesEnum;
import io.grpc.StatusRuntimeException;
import io.grpc.stub.MetadataUtils;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.dataloader.DataLoader;
import org.springframework.graphql.data.method.annotation.Argument;
import org.springframework.graphql.data.method.annotation.QueryMapping;
import org.springframework.graphql.data.method.annotation.SchemaMapping;
import org.springframework.stereotype.Controller;
import synapsedesk.auth.Common.PageRequest;
import synapsedesk.auth.Common.SortOrder;
import synapsedesk.ingestion.Document.DocumentIdRequest;
import synapsedesk.ingestion.Document.DocumentResponse;
import synapsedesk.ingestion.Document.ListDocumentsRequest;
import synapsedesk.ingestion.Document.ListDocumentsResponse;
import synapsedesk.ingestion.DocumentServiceGrpc;

/** `Query.document`, `Query.documents`, and the document edges. */
@Controller
public class DocumentsResolver {

  private static final long DEADLINE_SECONDS = 5;

  private final DocumentServiceGrpc.DocumentServiceBlockingStub stub;
  private final CurrentUser currentUser;

  public DocumentsResolver(
    DocumentServiceGrpc.DocumentServiceBlockingStub stub,
    CurrentUser currentUser
  ) {
    this.stub = stub;
    this.currentUser = currentUser;
  }

  @QueryMapping
  @RequirePermission(PermissionCodesEnum.DOCUMENT_READ)
  public DocumentGqlDto document(@Argument String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    try {
      DocumentResponse response = withMetadata(context).getDocument(
        DocumentIdRequest.newBuilder().setId(id).build()
      );

      return DocumentMapper.toDocumentGqlDto(response);
    } catch (StatusRuntimeException notFoundOrForbidden) {
      // Not found, or scoped to a department the caller is not in —
      // deliberately indistinguishable, matching `Query.document`'s own
      // schema description.
      return null;
    }
  }

  @QueryMapping(name = "documents")
  @RequirePermission(PermissionCodesEnum.DOCUMENT_READ)
  public DocumentPageGqlDto documents(
    @Argument int first,
    @Argument int page,
    @Argument String searchTerm
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    PageRequest.Builder pageRequest = PageRequest.newBuilder()
      .setPage(page)
      .setLimit(first)
      .setSortBy("createdAt")
      .setSortOrder(SortOrder.SORT_ORDER_DESC);
    if (searchTerm != null) {
      pageRequest.setSearchTerm(searchTerm);
    }

    ListDocumentsResponse response = withMetadata(context).listDocuments(
      ListDocumentsRequest.newBuilder()
        .setPage(pageRequest)
        .setIncludeDeleted(false)
        .build()
    );

    return new DocumentPageGqlDto(
      response
        .getItemsList()
        .stream()
        .map(DocumentMapper::toDocumentGqlDto)
        .toList(),
      DocumentMapper.toPageMetaGqlDto(response.getMeta())
    );
  }

  /** `Document.createdBy` — the uploader. */
  @SchemaMapping(typeName = "Document", field = "createdBy")
  public CompletableFuture<UserSummaryGqlDto> createdBy(
    DocumentGqlDto document,
    DataLoader<String, UserSummaryGqlDto> loader
  ) {
    if (document.createdById() == null) {
      return CompletableFuture.completedFuture(null);
    }

    RequestContext context = currentUser.require(CurrentRequest.request());

    return loader.load(document.createdById(), context);
  }

  /** The flat count beside the capped `departments` edge — the true, uncapped total. */
  @SchemaMapping(typeName = "Document", field = "departmentCount")
  public int departmentCount(DocumentGqlDto document) {
    return document.departmentIds().size();
  }

  /**
   * `Document.departments` — sliced to {@link GraphqlLimits#MAX_EDGE_LIST}
   * BEFORE the batch, matching `document.departmentIds.slice(0,
   * MAX_EDGE_LIST)`: an uncapped parent fails the whole field rather than
   * shortening it, since the batch RPC's own cap is an error, not a
   * truncation.
   */
  @SchemaMapping(typeName = "Document", field = "departments")
  public CompletableFuture<List<DepartmentGqlDto>> departments(
    DocumentGqlDto document,
    DataLoader<String, DepartmentGqlDto> loader
  ) {
    List<String> ids = document.departmentIds();
    if (ids.isEmpty()) {
      return CompletableFuture.completedFuture(List.of());
    }

    RequestContext context = currentUser.require(CurrentRequest.request());
    List<String> capped = ids.subList(
      0,
      Math.min(ids.size(), GraphqlLimits.MAX_EDGE_LIST)
    );

    return loader
      .loadMany(capped, Collections.nCopies(capped.size(), context))
      .thenApply(departments ->
        departments.stream().filter(java.util.Objects::nonNull).toList()
      );
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
