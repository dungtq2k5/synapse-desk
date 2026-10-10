package com.synapsedesk.gateway.knowledge;

import com.synapsedesk.gateway.model.CitationResponseDto;
import com.synapsedesk.gateway.model.KnowledgeArticleBlockResponseDto;
import com.synapsedesk.gateway.model.KnowledgeArticleDetailResponseDto;
import com.synapsedesk.gateway.model.KnowledgeArticleResponseDto;
import com.synapsedesk.gateway.model.KnowledgeAskResponseDto;
import com.synapsedesk.gateway.model.KnowledgeSearchResponseDto;
import com.synapsedesk.gateway.model.PaginationMetaDataResponseDto;
import com.synapsedesk.gateway.model.RetrievedChunkResponseDto;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import synapsedesk.auth.Common.PageMeta;
import synapsedesk.ingestion.Document.KnowledgeArticleBlockResponse;
import synapsedesk.ingestion.Document.KnowledgeArticleResponse;
import synapsedesk.rag.Rag.AnswerStatus;
import synapsedesk.rag.Rag.Citation;
import synapsedesk.rag.Rag.RetrievedChunk;
import synapsedesk.rag.Rag.SearchDegradation;

/** Wire knowledge articles, blocks, answers and search results -> REST DTOs. */
final class KnowledgeMapper {

  private KnowledgeMapper() {}

  static KnowledgeArticleResponseDto toArticleDto(
    KnowledgeArticleResponse article
  ) {
    return new KnowledgeArticleResponseDto()
      .id(article.getId())
      .title(article.getTitle())
      .updatedAt(toOffsetDateTime(article.getUpdatedAt()))
      .chunkCount(BigDecimal.valueOf(article.getChunkCount()));
  }

  static KnowledgeArticleBlockResponseDto toBlockDto(
    KnowledgeArticleBlockResponse block
  ) {
    return new KnowledgeArticleBlockResponseDto()
      .chunkIndex(BigDecimal.valueOf(block.getChunkIndex()))
      .pageNumber(
        block.hasPageNumber() ? BigDecimal.valueOf(block.getPageNumber()) : null
      )
      .contentText(block.getContentText());
  }

  static KnowledgeArticleDetailResponseDto toArticleDetailDto(
    KnowledgeArticleResponse article,
    List<KnowledgeArticleBlockResponse> blocks,
    PageMeta meta,
    boolean hasUnindexedPages
  ) {
    return new KnowledgeArticleDetailResponseDto()
      .article(toArticleDto(article))
      .blocks(blocks.stream().map(KnowledgeMapper::toBlockDto).toList())
      .meta(toPaginationMetaDto(meta))
      .hasUnindexedPages(hasUnindexedPages);
  }

  static KnowledgeAskResponseDto toAskDto(
    String content,
    AnswerStatus status,
    List<Citation> citations,
    String generationId
  ) {
    return new KnowledgeAskResponseDto()
      .content(content)
      .status(
        status == AnswerStatus.UNRECOGNIZED ||
          status == AnswerStatus.ANSWER_STATUS_UNSPECIFIED
          ? null
          : KnowledgeAskResponseDto.StatusEnum.fromValue(
              status.name().replace("ANSWER_STATUS_", "")
            )
      )
      .citations(
        citations.stream().map(KnowledgeMapper::toCitationDto).toList()
      )
      .generationId(generationId);
  }

  static KnowledgeSearchResponseDto toSearchDto(
    List<RetrievedChunk> chunks,
    SearchDegradation degraded
  ) {
    return new KnowledgeSearchResponseDto()
      .chunks(chunks.stream().map(KnowledgeMapper::toChunkDto).toList())
      .degraded(
        degraded == SearchDegradation.SEARCH_DEGRADATION_UNSPECIFIED ||
          degraded == SearchDegradation.UNRECOGNIZED
          ? null
          : KnowledgeSearchResponseDto.DegradedEnum.fromValue(
              degraded.name().replace("SEARCH_DEGRADATION_", "")
            )
      );
  }

  private static CitationResponseDto toCitationDto(Citation citation) {
    return new CitationResponseDto()
      .chunkId(citation.getChunkId())
      .documentId(citation.getDocumentId())
      .documentTitle(citation.getDocumentTitle())
      .pageNumber(
        citation.hasPageNumber()
          ? BigDecimal.valueOf(citation.getPageNumber())
          : null
      )
      .vectorPointId(citation.getVectorPointId());
  }

  private static RetrievedChunkResponseDto toChunkDto(RetrievedChunk chunk) {
    return new RetrievedChunkResponseDto()
      .chunkId(chunk.getChunkId())
      .documentId(chunk.getDocumentId())
      .documentTitle(chunk.getDocumentTitle())
      .pageNumber(
        chunk.hasPageNumber() ? BigDecimal.valueOf(chunk.getPageNumber()) : null
      )
      .chunkIndex(BigDecimal.valueOf(chunk.getChunkIndex()))
      .contentText(chunk.getContentText())
      .score(BigDecimal.valueOf(chunk.getScore()))
      .vectorPointId(chunk.getVectorPointId());
  }

  private static PaginationMetaDataResponseDto toPaginationMetaDto(
    PageMeta meta
  ) {
    return new PaginationMetaDataResponseDto(
      BigDecimal.valueOf(meta.getTotalItems()),
      BigDecimal.valueOf(meta.getItemCount()),
      BigDecimal.valueOf(meta.getItemsPerPage()),
      BigDecimal.valueOf(meta.getTotalPages()),
      BigDecimal.valueOf(meta.getCurrentPage())
    );
  }

  private static OffsetDateTime toOffsetDateTime(
    com.google.protobuf.Timestamp timestamp
  ) {
    return Instant.ofEpochSecond(
      timestamp.getSeconds(),
      timestamp.getNanos()
    ).atOffset(ZoneOffset.UTC);
  }
}
