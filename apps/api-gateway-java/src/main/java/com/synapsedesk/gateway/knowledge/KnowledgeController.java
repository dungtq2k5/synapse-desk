package com.synapsedesk.gateway.knowledge;

import com.synapsedesk.gateway.auth.CurrentRequest;
import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.generated.api.KnowledgeApi;
import com.synapsedesk.gateway.generated.model.KnowledgeAskDto;
import com.synapsedesk.gateway.generated.model.KnowledgeControllerAskV1200Response;
import com.synapsedesk.gateway.generated.model.KnowledgeControllerGetArticleV1200Response;
import com.synapsedesk.gateway.generated.model.KnowledgeControllerListArticlesV1200Response;
import com.synapsedesk.gateway.generated.model.KnowledgeControllerListArticlesV1200ResponseData;
import com.synapsedesk.gateway.generated.model.KnowledgeControllerSearchV1200Response;
import com.synapsedesk.gateway.generated.model.KnowledgeSearchDto;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import com.synapsedesk.gateway.throttle.RouteThrottle;
import com.synapsedesk.gateway.throttle.ThrottleOverride;
import com.synapsedesk.gateway.throttle.ThrottlerTiers;
import io.grpc.stub.MetadataUtils;
import java.math.BigDecimal;
import org.springframework.http.ResponseEntity;
import org.springframework.lang.Nullable;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import synapsedesk.auth.Common.PageRequest;
import synapsedesk.auth.Common.SortOrder;
import synapsedesk.ingestion.Document.GetKnowledgeArticleRequest;
import synapsedesk.ingestion.Document.KnowledgeArticleDetailResponse;
import synapsedesk.ingestion.Document.ListKnowledgeArticlesRequest;
import synapsedesk.ingestion.Document.ListKnowledgeArticlesResponse;
import synapsedesk.ingestion.DocumentServiceGrpc;
import synapsedesk.rag.Rag.ChatRequest;
import synapsedesk.rag.Rag.ChatResponse;
import synapsedesk.rag.Rag.SearchRequest;
import synapsedesk.rag.Rag.SearchResponse;
import synapsedesk.rag.RagServiceGrpc;

/**
 * `KnowledgeApi` — the knowledge base's read surface (`knowledge.controller.ts`
 * and `knowledge-articles.controller.ts`, reproduced as one interface,
 * matching the published contract's own grouping). Two peers: `articles`
 * routes go through the EXISTING {@code documentServiceStub}
 * (ingestion-service); `ask`/`search` are the first Java routes to reach
 * rag-service, so this port adds {@code ragServiceStub} to {@code
 * GrpcChannels}.
 *
 * <p><b>No {@code @RequirePermission} anywhere in this class — deliberately,
 * matching Node exactly.</b> A knowledge base must be readable by every
 * authenticated user, including one holding zero permissions; the actual
 * narrowing (org-wide ∪ caller's departments) happens server-side from
 * gRPC metadata, the same predicate `GET /documents` uses. {@code
 * PermissionInterceptor} fails open on a method with no annotation — the
 * same fail-open Node's own `PermissionGuard` performs with no {@code
 * @RequirePermission} — so simply not annotating reproduces this exactly.
 * Every method still calls {@code currentUser.require(...)}, so an
 * unauthenticated caller is refused regardless.
 *
 * <p><b>{@code ask}/{@code search} trim their body strings by hand.</b>
 * Node's {@code @Transform(trimIfString)} has no Bean Validation
 * equivalent — it is a mutation, not a constraint — so the generator drops
 * it entirely. A value that is all whitespace would pass the generated
 * {@code @Size(min=1)} check on the UNTRIMMED string; Node's pipeline trims
 * FIRST, then validates the trimmed result is non-empty. Reproduced here by
 * trimming before use and refusing an empty result with the same 400 a
 * failed {@code @MinLength(1)} would have produced.
 *
 * <p><b>{@code ask} refuses at the AI cap; {@code search} degrades.</b> A
 * generated answer has no degraded form, so rag-service raises a gRPC
 * {@code PERMISSION_DENIED} carrying an {@code [http:402]} marker for
 * `ask` — {@link com.synapsedesk.gateway.error.GrpcStatusMapping} already
 * maps that marker generically, so nothing route-specific is needed here.
 * `search` instead returns 200 with {@code degraded: LEXICAL_ONLY} set.
 */
@RestController
public class KnowledgeController implements KnowledgeApi {

  private static final long DEADLINE_SECONDS = 5;

  private final DocumentServiceGrpc.DocumentServiceBlockingStub documentStub;
  private final RagServiceGrpc.RagServiceBlockingStub ragStub;
  private final CurrentUser currentUser;

  public KnowledgeController(
    DocumentServiceGrpc.DocumentServiceBlockingStub documentStub,
    RagServiceGrpc.RagServiceBlockingStub ragStub,
    CurrentUser currentUser
  ) {
    this.documentStub = documentStub;
    this.ragStub = ragStub;
    this.currentUser = currentUser;
  }

  @Override
  public ResponseEntity<KnowledgeControllerListArticlesV1200Response> knowledgeControllerListArticlesV1(
    BigDecimal page,
    BigDecimal limit,
    String sortBy,
    String sortOrder,
    @Nullable String searchTerm
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    PageRequest.Builder pageRequest = PageRequest.newBuilder()
      .setPage(page.intValue())
      .setLimit(limit.intValue())
      .setSortBy(sortBy)
      .setSortOrder(
        "DESC".equalsIgnoreCase(sortOrder)
          ? SortOrder.SORT_ORDER_DESC
          : SortOrder.SORT_ORDER_ASC
      );
    if (searchTerm != null) {
      pageRequest.setSearchTerm(searchTerm);
    }

    ListKnowledgeArticlesResponse response = withDocumentMetadata(
      context
    ).listKnowledgeArticles(
      ListKnowledgeArticlesRequest.newBuilder().setPage(pageRequest).build()
    );

    KnowledgeControllerListArticlesV1200ResponseData data =
      new KnowledgeControllerListArticlesV1200ResponseData()
        .items(
          response
            .getItemsList()
            .stream()
            .map(KnowledgeMapper::toArticleDto)
            .toList()
        )
        .meta(KnowledgeMapper.toMetaDto(response.getMeta()));

    return ResponseEntity.ok(
      new KnowledgeControllerListArticlesV1200Response()
        .success(true)
        .statusCode(BigDecimal.valueOf(200))
        .message("OK")
        .data(data)
    );
  }

  @Override
  public ResponseEntity<KnowledgeControllerGetArticleV1200Response> knowledgeControllerGetArticleV1(
    String id,
    BigDecimal page,
    BigDecimal limit
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    // The service always sorts blocks by `chunkIndex` server-side regardless
    // of what this sends — Node deliberately sends an EMPTY sortBy rather
    // than a second hardcoded `"chunkIndex"` literal that must agree with
    // the service's own allowlist. Not the shared list-pagination default.
    PageRequest blockRange = PageRequest.newBuilder()
      .setPage(page.intValue())
      .setLimit(limit.intValue())
      .setSortBy("")
      .build();

    KnowledgeArticleDetailResponse response = withDocumentMetadata(
      context
    ).getKnowledgeArticle(
      GetKnowledgeArticleRequest.newBuilder()
        .setId(id)
        .setPage(blockRange)
        .build()
    );

    return ResponseEntity.ok(
      new KnowledgeControllerGetArticleV1200Response()
        .success(true)
        .statusCode(BigDecimal.valueOf(200))
        .message("OK")
        .data(
          KnowledgeMapper.toArticleDetailDto(
            response.getArticle(),
            response.getBlocksList(),
            response.getMeta(),
            response.getHasUnindexedPages()
          )
        )
    );
  }

  @Override
  @ThrottleOverride(
    tier = ThrottlerTiers.MEDIUM,
    ttlMs = RouteThrottle.KNOWLEDGE_ASK_TTL_MS,
    limit = RouteThrottle.KNOWLEDGE_ASK_LIMIT
  )
  public ResponseEntity<KnowledgeControllerAskV1200Response> knowledgeControllerAskV1(
    KnowledgeAskDto knowledgeAskDto
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());
    String message = requireNonBlank(knowledgeAskDto.getMessage(), "message");

    // History/attachments are structurally omitted from `KnowledgeAskDto` —
    // an empty history and zero attachment count is what keeps rag-service's
    // ledger row a `CHAT_ANSWER` with no ticket attribution.
    ChatRequest wire = ChatRequest.newBuilder()
      .setMessage(message)
      .setAttachmentCount(0)
      .build();

    ChatResponse response = withRagMetadata(context).ask(wire);

    return ResponseEntity.ok(
      new KnowledgeControllerAskV1200Response()
        .success(true)
        .statusCode(BigDecimal.valueOf(200))
        .message("Answer generated")
        .data(
          KnowledgeMapper.toAskDto(
            response.getContent(),
            response.getStatus(),
            response.getCitationsList(),
            response.getGenerationId()
          )
        )
    );
  }

  @Override
  @ThrottleOverride(
    tier = ThrottlerTiers.MEDIUM,
    ttlMs = RouteThrottle.KNOWLEDGE_SEARCH_TTL_MS,
    limit = RouteThrottle.KNOWLEDGE_SEARCH_LIMIT
  )
  public ResponseEntity<KnowledgeControllerSearchV1200Response> knowledgeControllerSearchV1(
    KnowledgeSearchDto knowledgeSearchDto
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());
    String query = requireNonBlank(knowledgeSearchDto.getQuery(), "query");

    SearchRequest wire = SearchRequest.newBuilder()
      .setQuery(query)
      .setLimit(knowledgeSearchDto.getLimit().intValue())
      .setSkipRerank(Boolean.TRUE.equals(knowledgeSearchDto.getSkipRerank()))
      .build();

    SearchResponse response = withRagMetadata(context).search(wire);

    return ResponseEntity.ok(
      new KnowledgeControllerSearchV1200Response()
        .success(true)
        .statusCode(BigDecimal.valueOf(200))
        .message("Search completed")
        .data(
          KnowledgeMapper.toSearchDto(
            response.getChunksList(),
            response.getDegraded()
          )
        )
    );
  }

  /**
   * Node's {@code @Transform(trimIfString)} + {@code @MinLength(1)},
   * reproduced — the generator drops the transform, so a value that is all
   * whitespace would otherwise pass the generated {@code @Size(min=1)}
   * check on the untrimmed string.
   */
  private static String requireNonBlank(String value, String field) {
    String trimmed = value == null ? "" : value.trim();
    if (trimmed.isEmpty()) {
      throw new ResponseStatusException(
        org.springframework.http.HttpStatus.BAD_REQUEST,
        field + " must not be blank"
      );
    }
    return trimmed;
  }

  private DocumentServiceGrpc.DocumentServiceBlockingStub withDocumentMetadata(
    RequestContext context
  ) {
    return documentStub
      .withDeadlineAfter(
        DEADLINE_SECONDS,
        java.util.concurrent.TimeUnit.SECONDS
      )
      .withInterceptors(
        MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context))
      );
  }

  private RagServiceGrpc.RagServiceBlockingStub withRagMetadata(
    RequestContext context
  ) {
    return ragStub
      .withDeadlineAfter(
        DEADLINE_SECONDS,
        java.util.concurrent.TimeUnit.SECONDS
      )
      .withInterceptors(
        MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context))
      );
  }
}
