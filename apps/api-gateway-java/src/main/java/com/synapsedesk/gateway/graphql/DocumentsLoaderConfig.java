package com.synapsedesk.gateway.graphql;

import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.documents.DocumentGqlDto;
import com.synapsedesk.gateway.documents.DocumentMapper;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import io.grpc.stub.MetadataUtils;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import org.dataloader.BatchLoaderEnvironment;
import org.springframework.context.annotation.Configuration;
import org.springframework.graphql.execution.BatchLoaderRegistry;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;
import synapsedesk.ingestion.Document.ListDocumentsByIdsRequest;
import synapsedesk.ingestion.Document.ListDocumentsByIdsResponse;
import synapsedesk.ingestion.DocumentServiceGrpc;

/**
 * The documents loader — `document.loader.ts`, reproduced. Deliberately NOT
 * cached (Node's own decision, ADR 0029): a `Document` is large, changes
 * asynchronously as ingestion re-indexes it, and its only consumers today are
 * cold reads — `IngestionJob.document`, later the analytics edges.
 *
 * <p>Same loader contract as {@link UsersLoaderConfig}: the bridge to the
 * blocking `DocumentServiceGrpc` stub is exactly one {@code
 * Mono.fromCallable(...).subscribeOn(Schedulers.boundedElastic())}, and the
 * caller's {@link RequestContext} travels through the {@code DataLoader}'s
 * key context rather than a ThreadLocal a pooled thread cannot read.
 */
@Configuration
public class DocumentsLoaderConfig {

  private static final long DEADLINE_SECONDS = 5;

  private final DocumentServiceGrpc.DocumentServiceBlockingStub stub;

  public DocumentsLoaderConfig(
      BatchLoaderRegistry registry, DocumentServiceGrpc.DocumentServiceBlockingStub stub) {
    this.stub = stub;

    registry
        .forTypePair(String.class, DocumentGqlDto.class)
        .registerMappedBatchLoader(
            (ids, environment) ->
                Mono.fromCallable(() -> fetch(ids, environment)).subscribeOn(Schedulers.boundedElastic()));
  }

  private Map<String, DocumentGqlDto> fetch(Set<String> ids, BatchLoaderEnvironment environment) {
    RequestContext context = (RequestContext) environment.getKeyContexts().values().iterator().next();

    ListDocumentsByIdsResponse response =
        withMetadata(context)
            .listDocumentsByIds(ListDocumentsByIdsRequest.newBuilder().addAllDocumentIds(ids).build());

    Map<String, DocumentGqlDto> byId = new HashMap<>();
    for (var document : response.getItemsList()) {
      DocumentGqlDto mapped = DocumentMapper.toDocumentGqlDto(document);
      byId.put(mapped.id(), mapped);
    }

    return byId;
  }

  private DocumentServiceGrpc.DocumentServiceBlockingStub withMetadata(RequestContext context) {
    return stub
        .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
        .withInterceptors(MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context)));
  }
}
