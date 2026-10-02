package com.synapsedesk.gateway.knowledge;

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
import com.synapsedesk.gateway.model.KnowledgeAskDto;
import com.synapsedesk.gateway.model.KnowledgeSearchDto;
import java.math.BigDecimal;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.server.ResponseStatusException;
import synapsedesk.auth.Common.PageRequest;
import synapsedesk.ingestion.Document.GetKnowledgeArticleRequest;
import synapsedesk.ingestion.Document.KnowledgeArticleDetailResponse;
import synapsedesk.ingestion.Document.KnowledgeArticleResponse;
import synapsedesk.ingestion.DocumentServiceGrpc;
import synapsedesk.rag.Rag.AnswerStatus;
import synapsedesk.rag.Rag.ChatRequest;
import synapsedesk.rag.Rag.ChatResponse;
import synapsedesk.rag.Rag.SearchRequest;
import synapsedesk.rag.Rag.SearchResponse;
import synapsedesk.rag.RagServiceGrpc;

/**
 * `KnowledgeApi`'s two sharpest properties: `ask`/`search` reject an
 * all-whitespace body AFTER trimming it (the dropped {@code
 * @Transform(trimIfString)}), and `getArticle` sends an explicit EMPTY
 * `sortBy` on its block-range page request — not the shared list-pagination
 * default — since the service always sorts blocks by `chunkIndex`
 * server-side regardless of what this sends.
 */
class KnowledgeControllerTest {

  private final DocumentServiceGrpc.DocumentServiceBlockingStub documentStub =
    mock(DocumentServiceGrpc.DocumentServiceBlockingStub.class);
  private final RagServiceGrpc.RagServiceBlockingStub ragStub = mock(
    RagServiceGrpc.RagServiceBlockingStub.class
  );
  private final CurrentUser currentUser = mock(CurrentUser.class);
  private KnowledgeController controller;

  @BeforeEach
  void setUp() {
    when(documentStub.withDeadlineAfter(anyLong(), any())).thenReturn(
      documentStub
    );
    when(documentStub.withInterceptors(any())).thenReturn(documentStub);
    when(ragStub.withDeadlineAfter(anyLong(), any())).thenReturn(ragStub);
    when(ragStub.withInterceptors(any())).thenReturn(ragStub);
    when(currentUser.require(any())).thenReturn(
      new com.synapsedesk.gateway.auth.RequestContext(
        "agent-1",
        "org-1",
        false,
        java.util.List.of(),
        java.util.List.of(),
        true,
        "127.0.0.1",
        "test"
      )
    );
    controller = new KnowledgeController(documentStub, ragStub, currentUser);

    RequestContextHolder.setRequestAttributes(
      new ServletRequestAttributes(new MockHttpServletRequest())
    );
  }

  @AfterEach
  void tearDown() {
    RequestContextHolder.resetRequestAttributes();
  }

  @Test
  void getArticleSendsAnExplicitEmptySortByOnTheBlockRange() {
    when(documentStub.getKnowledgeArticle(any())).thenReturn(wireDetail());

    controller.knowledgeControllerGetArticleV1(
      "article-1",
      BigDecimal.ONE,
      BigDecimal.TEN
    );

    ArgumentCaptor<GetKnowledgeArticleRequest> captor = ArgumentCaptor.forClass(
      GetKnowledgeArticleRequest.class
    );
    verify(documentStub).getKnowledgeArticle(captor.capture());
    assertThat(captor.getValue().getPage().getSortBy()).isEmpty();
  }

  @Test
  void askRefusesAnAllWhitespaceMessageAfterTrimming() {
    KnowledgeAskDto dto = new KnowledgeAskDto();
    dto.setMessage("   ");

    assertThatThrownBy(() ->
      controller.knowledgeControllerAskV1(dto)
    ).isInstanceOf(ResponseStatusException.class);
    verify(ragStub, never()).ask(any());
  }

  @Test
  void askForwardsTheTrimmedMessageWithEmptyHistoryAndZeroAttachments() {
    when(ragStub.ask(any())).thenReturn(
      ChatResponse.newBuilder()
        .setContent("answer")
        .setStatus(AnswerStatus.ANSWER_STATUS_DOC_ANSWER)
        .setGenerationId("gen-1")
        .build()
    );
    KnowledgeAskDto dto = new KnowledgeAskDto();
    dto.setMessage("  what is the refund policy?  ");

    controller.knowledgeControllerAskV1(dto);

    ArgumentCaptor<ChatRequest> captor = ArgumentCaptor.forClass(
      ChatRequest.class
    );
    verify(ragStub).ask(captor.capture());
    assertThat(captor.getValue().getMessage()).isEqualTo(
      "what is the refund policy?"
    );
    assertThat(captor.getValue().getHistoryList()).isEmpty();
    assertThat(captor.getValue().getAttachmentsList()).isEmpty();
    assertThat(captor.getValue().getAttachmentCount()).isEqualTo(0);
  }

  @Test
  void searchRefusesAnAllWhitespaceQueryAfterTrimming() {
    KnowledgeSearchDto dto = new KnowledgeSearchDto();
    dto.setQuery("   ");
    dto.setLimit(BigDecimal.ZERO);

    assertThatThrownBy(() ->
      controller.knowledgeControllerSearchV1(dto)
    ).isInstanceOf(ResponseStatusException.class);
    verify(ragStub, never()).search(any());
  }

  @Test
  void searchForwardsTheTrimmedQueryLimitAndSkipRerank() {
    when(ragStub.search(any())).thenReturn(SearchResponse.getDefaultInstance());
    KnowledgeSearchDto dto = new KnowledgeSearchDto();
    dto.setQuery("  refund policy  ");
    dto.setLimit(BigDecimal.valueOf(20));
    dto.setSkipRerank(true);

    controller.knowledgeControllerSearchV1(dto);

    ArgumentCaptor<SearchRequest> captor = ArgumentCaptor.forClass(
      SearchRequest.class
    );
    verify(ragStub).search(captor.capture());
    assertThat(captor.getValue().getQuery()).isEqualTo("refund policy");
    assertThat(captor.getValue().getLimit()).isEqualTo(20);
    assertThat(captor.getValue().getSkipRerank()).isTrue();
  }

  private static KnowledgeArticleDetailResponse wireDetail() {
    Timestamp now = Timestamp.newBuilder().setSeconds(1_756_684_800).build();
    return KnowledgeArticleDetailResponse.newBuilder()
      .setArticle(
        KnowledgeArticleResponse.newBuilder()
          .setId("article-1")
          .setTitle("Title")
          .setUpdatedAt(now)
          .setChunkCount(3)
          .build()
      )
      .setHasUnindexedPages(false)
      .build();
  }
}
