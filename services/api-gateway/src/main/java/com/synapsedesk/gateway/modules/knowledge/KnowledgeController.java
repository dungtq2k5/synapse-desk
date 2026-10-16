package com.synapsedesk.gateway.modules.knowledge;

import com.synapsedesk.gateway.common.auth.CurrentRequest;
import com.synapsedesk.gateway.common.auth.CurrentUser;
import com.synapsedesk.gateway.common.auth.RequestContext;
import com.synapsedesk.gateway.common.grpc.CallerMetadata;
import com.synapsedesk.gateway.common.openapi.ApiErrors;
import com.synapsedesk.gateway.common.throttle.RouteThrottle;
import com.synapsedesk.gateway.common.throttle.ThrottleOverride;
import com.synapsedesk.gateway.common.throttle.ThrottlerTiers;
import com.synapsedesk.gateway.common.web.ApiPaths;
import com.synapsedesk.gateway.common.web.ApiResponse;
import com.synapsedesk.gateway.common.web.PageMeta;
import com.synapsedesk.gateway.common.web.PagedData;
import com.synapsedesk.gateway.common.web.SortDirection;
import com.synapsedesk.gateway.modules.knowledge.dto.rest.KnowledgeArticleDetailResponseDto;
import com.synapsedesk.gateway.modules.knowledge.dto.rest.KnowledgeArticleResponseDto;
import com.synapsedesk.gateway.modules.knowledge.dto.rest.KnowledgeAskDto;
import com.synapsedesk.gateway.modules.knowledge.dto.rest.KnowledgeAskResponseDto;
import com.synapsedesk.gateway.modules.knowledge.dto.rest.KnowledgeSearchDto;
import com.synapsedesk.gateway.modules.knowledge.dto.rest.KnowledgeSearchResponseDto;
import io.grpc.stub.MetadataUtils;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import java.math.BigDecimal;
import java.util.UUID;
import org.jspecify.annotations.Nullable;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
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
 * `KnowledgeApi` — the knowledge base's read surface, articles and Q&A as one
 * interface, matching the published contract's own grouping. Two peers:
 * `articles` routes go through {@code documentServiceStub}
 * (ingestion-service); `ask`/`search` reach rag-service through {@code
 * ragServiceStub} on {@code GrpcChannels}.
 *
 * <p><b>No {@code @RequirePermission} anywhere in this class — deliberately.</b> A knowledge base must be readable by every
 * authenticated user, including one holding zero permissions; the actual
 * narrowing (org-wide ∪ caller's departments) happens server-side from
 * gRPC metadata, the same predicate `GET /documents` uses. {@code
 * PermissionInterceptor} fails open on a method with no annotation, so
 * simply not annotating gives exactly this.
 * Every method still calls {@code currentUser.require(...)}, so an
 * unauthenticated caller is refused regardless.
 *
 * <p><b>{@code ask}/{@code search} trim their body strings by hand.</b>
 * Trimming has no Bean Validation equivalent — it is a mutation, not a
 * constraint. A value that is all whitespace would pass the generated
 * {@code @Size(min=1)} check on the UNTRIMMED string, so these routes trim
 * FIRST, then refuse an empty result with the same 400 a failed length
 * check produces.
 *
 * <p><b>{@code ask} refuses at the AI cap; {@code search} degrades.</b> A
 * generated answer has no degraded form, so rag-service raises a gRPC
 * {@code PERMISSION_DENIED} carrying an {@code [http:402]} marker for
 * `ask` — {@link com.synapsedesk.gateway.common.error.GrpcStatusMapping} already
 * maps that marker generically, so nothing route-specific is needed here.
 * `search` instead returns 200 with {@code degraded: LEXICAL_ONLY} set.
 *
 * <p>`listArticles`'s meta is {@link PageMeta#from}.
 */
@Tag(name = "Knowledge")
@RestController
@RequestMapping(ApiPaths.V1)
@Validated
public class KnowledgeController {

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

  @GetMapping(value = "/knowledge/articles", produces = { "application/json" })
  @ApiErrors({ "400", "401" })
  public ResponseEntity<
    ApiResponse<PagedData<KnowledgeArticleResponseDto>>
  > knowledgeControllerListArticlesV1(
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
      defaultValue = "updatedAt"
    ) String sortBy,
    @Valid @RequestParam(
      value = "sortOrder",
      required = false,
      defaultValue = "ASC"
    ) SortDirection sortOrder,
    @Valid @RequestParam(
      value = "searchTerm",
      required = false
    ) @Nullable String searchTerm
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

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

    ListKnowledgeArticlesResponse response = withDocumentMetadata(
      context
    ).listKnowledgeArticles(
      ListKnowledgeArticlesRequest.newBuilder().setPage(pageRequest).build()
    );

    PagedData<KnowledgeArticleResponseDto> data = new PagedData<>(
      response
        .getItemsList()
        .stream()
        .map(KnowledgeMapper::toArticleDto)
        .toList(),
      PageMeta.from(response.getMeta())
    );

    return ResponseEntity.ok(ApiResponse.of(200, "OK", data));
  }

  @GetMapping(
    value = "/knowledge/articles/{id}",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "404" })
  public ResponseEntity<
    ApiResponse<KnowledgeArticleDetailResponseDto>
  > knowledgeControllerGetArticleV1(
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
      value = "passage",
      required = false
    ) @Nullable UUID passage
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    // The service always sorts blocks by `chunkIndex` server-side regardless
    // of what this sends, so this sends an EMPTY sortBy rather than a second
    // hardcoded `"chunkIndex"` literal that must agree with the service's own
    // allowlist. Not the shared list-pagination default.
    PageRequest blockRange = PageRequest.newBuilder()
      .setPage(page.intValue())
      .setLimit(limit.intValue())
      .setSortBy("")
      .build();

    GetKnowledgeArticleRequest.Builder request =
      GetKnowledgeArticleRequest.newBuilder().setId(id).setPage(blockRange);
    // A cited passage: the service answers the page that holds it.
    if (passage != null) {
      request.setPassage(passage.toString());
    }
    KnowledgeArticleDetailResponse response = withDocumentMetadata(
      context
    ).getKnowledgeArticle(request.build());

    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "OK",
        KnowledgeMapper.toArticleDetailDto(
          response.getArticle(),
          response.getBlocksList(),
          response.getMeta(),
          response.getHasUnindexedPages(),
          response.hasPassageIndex() ? response.getPassageIndex() : null
        )
      )
    );
  }

  @PostMapping(
    value = "/knowledge/ask",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "402" })
  @ThrottleOverride(
    tier = ThrottlerTiers.MEDIUM,
    ttlMs = RouteThrottle.KNOWLEDGE_ASK_TTL_MS,
    limit = RouteThrottle.KNOWLEDGE_ASK_LIMIT
  )
  public ResponseEntity<
    ApiResponse<KnowledgeAskResponseDto>
  > knowledgeControllerAskV1(
    @Valid @RequestBody KnowledgeAskDto knowledgeAskDto
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
      ApiResponse.of(
        200,
        "Answer generated",
        KnowledgeMapper.toAskDto(
          response.getContent(),
          response.getStatus(),
          response.getCitationsList(),
          response.getGenerationId()
        )
      )
    );
  }

  @PostMapping(
    value = "/knowledge/search",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401" })
  @ThrottleOverride(
    tier = ThrottlerTiers.MEDIUM,
    ttlMs = RouteThrottle.KNOWLEDGE_SEARCH_TTL_MS,
    limit = RouteThrottle.KNOWLEDGE_SEARCH_LIMIT
  )
  public ResponseEntity<
    ApiResponse<KnowledgeSearchResponseDto>
  > knowledgeControllerSearchV1(
    @Valid @RequestBody KnowledgeSearchDto knowledgeSearchDto
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
      ApiResponse.of(
        200,
        "Search completed",
        KnowledgeMapper.toSearchDto(
          response.getChunksList(),
          response.getDegraded()
        )
      )
    );
  }

  /**
   * Trims, then refuses an empty result — a value that is all whitespace
   * would otherwise pass the generated {@code @Size(min=1)} check on the
   * untrimmed string.
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
