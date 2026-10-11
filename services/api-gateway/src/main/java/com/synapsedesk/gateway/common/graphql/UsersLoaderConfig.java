package com.synapsedesk.gateway.common.graphql;

import com.synapsedesk.gateway.common.auth.RequestContext;
import com.synapsedesk.gateway.common.grpc.CallerMetadata;
import io.grpc.stub.MetadataUtils;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import org.springframework.context.annotation.Configuration;
import org.springframework.graphql.execution.BatchLoaderRegistry;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;
import synapsedesk.auth.User.ListUsersByIdsRequest;
import synapsedesk.auth.User.ListUsersByIdsResponse;
import synapsedesk.auth.User.UserProjection;
import synapsedesk.auth.User.UserSummary;
import synapsedesk.auth.UserServiceGrpc;

/**
 * The users loader — batches user-summary lookups by id into one
 * `ListUsersByIds` call per request. No entity cache (deferred).
 *
 * <p><b>The loader contract, applied.</b> Spring for GraphQL's {@link
 * BatchLoaderRegistry} is reactive-only; the bridge to this gateway's
 * blocking gRPC stub is exactly one {@code Mono.fromCallable(...)
 * .subscribeOn(Schedulers.boundedElastic())}, here and nowhere else. The
 * caller's {@link RequestContext} cannot be read off {@link
 * org.springframework.web.context.request.RequestContextHolder} on a
 * `boundedElastic` thread — every resolver that loads through this MUST pass
 * its own captured context as the loader's key context
 * ({@code dataLoader.load(id, context)}), which arrives here via {@link
 * org.dataloader.BatchLoaderEnvironment#getKeyContexts()}.
 */
@Configuration
public class UsersLoaderConfig {

  private static final long DEADLINE_SECONDS = 5;

  private final UserServiceGrpc.UserServiceBlockingStub stub;

  public UsersLoaderConfig(
    BatchLoaderRegistry registry,
    UserServiceGrpc.UserServiceBlockingStub stub
  ) {
    this.stub = stub;

    registry
      .forTypePair(String.class, UserSummaryGqlDto.class)
      .registerMappedBatchLoader((ids, environment) ->
        Mono.fromCallable(() -> fetch(ids, environment)).subscribeOn(
          Schedulers.boundedElastic()
        )
      );
  }

  private Map<String, UserSummaryGqlDto> fetch(
    Set<String> ids,
    org.dataloader.BatchLoaderEnvironment environment
  ) {
    // Every key in one batch was loaded by the SAME request (Spring builds a
    // fresh `DataLoaderRegistry` per request), so any key's context is the
    // batch's context — there is exactly one caller to build metadata from.
    RequestContext context = (RequestContext) environment
      .getKeyContexts()
      .values()
      .iterator()
      .next();

    ListUsersByIdsResponse response = withMetadata(context).listUsersByIds(
      ListUsersByIdsRequest.newBuilder()
        .setOrganizationId(context.organizationIdOrEmpty())
        .addAllUserIds(ids)
        // `true`: a loader asks "who IS this?", never "who can act on
        // this?" — see the proto's own comment on the flag.
        .setIncludeInactive(true)
        .setProjection(UserProjection.USER_PROJECTION_SUMMARY)
        .build()
    );

    Map<String, UserSummaryGqlDto> byId = new HashMap<>();
    for (UserSummary summary : response.getSummariesList()) {
      byId.put(summary.getUserId(), toUserSummaryGqlDto(summary));
    }

    return byId;
  }

  private static UserSummaryGqlDto toUserSummaryGqlDto(UserSummary summary) {
    return new UserSummaryGqlDto(
      summary.getUserId(),
      summary.getFullName(),
      summary.hasAvatarUrl() ? summary.getAvatarUrl() : null,
      summary.getIsLocked(),
      summary.hasDeletedAt()
        ? java.time.Instant.ofEpochSecond(
            summary.getDeletedAt().getSeconds(),
            summary.getDeletedAt().getNanos()
          ).atOffset(java.time.ZoneOffset.UTC)
        : null
    );
  }

  private UserServiceGrpc.UserServiceBlockingStub withMetadata(
    RequestContext context
  ) {
    return stub
      .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
      .withInterceptors(
        MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context))
      );
  }
}
