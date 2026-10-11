package com.synapsedesk.gateway.common.graphql;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.synapsedesk.gateway.common.auth.RequestContext;
import graphql.GraphQLContext;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.dataloader.DataLoader;
import org.dataloader.DataLoaderRegistry;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.graphql.execution.DefaultBatchLoaderRegistry;
import synapsedesk.auth.User.ListUsersByIdsRequest;
import synapsedesk.auth.User.ListUsersByIdsResponse;
import synapsedesk.auth.User.UserSummary;
import synapsedesk.auth.UserServiceGrpc;

/**
 * The three rows the loader contract requires: one peer call for N entities,
 * that call carrying the caller's context, and two concurrent callers never
 * sharing one another's context on the pooled `boundedElastic` thread the
 * batch function runs on.
 *
 * <p>Mocked at the stub, not over real gRPC: a real `NettyServerBuilder` /
 * `grpc-core` combination on this classpath hits a pre-existing binary
 * incompatibility (two `grpc-core` versions resolve — 1.55.1 and 1.83.1 —
 * unrelated to this plan and out of scope to re-pin here). The property
 * under test — the RIGHT context reaching the RIGHT request, uncontaminated
 * — is fully observable through the request body's `organizationId`, which
 * this RPC already carries, without needing the wire.
 */
class UsersLoaderConfigTest {

  private static RequestContext contextFor(String organizationId, String sub) {
    return new RequestContext(
      sub,
      organizationId,
      false,
      List.of(),
      List.of("ticket.read.all"),
      true,
      "127.0.0.1",
      "test"
    );
  }

  private UserServiceGrpc.UserServiceBlockingStub mockedStub() {
    UserServiceGrpc.UserServiceBlockingStub stub = mock(
      UserServiceGrpc.UserServiceBlockingStub.class
    );
    when(stub.withDeadlineAfter(anyLong(), any())).thenReturn(stub);
    when(stub.withInterceptors(any())).thenReturn(stub);

    return stub;
  }

  private DataLoader<String, UserSummaryGqlDto> loaderFor(
    UserServiceGrpc.UserServiceBlockingStub stub
  ) {
    DefaultBatchLoaderRegistry registry = new DefaultBatchLoaderRegistry();
    new UsersLoaderConfig(registry, stub);

    DataLoaderRegistry dataLoaderRegistry = new DataLoaderRegistry();
    registry.registerDataLoaders(
      dataLoaderRegistry,
      GraphQLContext.getDefault()
    );

    return dataLoaderRegistry.getDataLoader(UserSummaryGqlDto.class.getName());
  }

  @Test
  void fiftyIdsProduceExactlyOnePeerCallCarryingTheCallersContext()
    throws Exception {
    UserServiceGrpc.UserServiceBlockingStub stub = mockedStub();
    when(stub.listUsersByIds(any())).thenAnswer(invocation -> {
      ListUsersByIdsRequest request = invocation.getArgument(0);
      return ListUsersByIdsResponse.newBuilder()
        .addAllSummaries(
          request
            .getUserIdsList()
            .stream()
            .map(id ->
              UserSummary.newBuilder().setUserId(id).setFullName("N").build()
            )
            .toList()
        )
        .build();
    });

    DataLoader<String, UserSummaryGqlDto> loader = loaderFor(stub);
    RequestContext context = contextFor(
      "11111111-1111-4111-8111-111111111111",
      "agent-1"
    );

    List<CompletableFuture<UserSummaryGqlDto>> futures =
      java.util.stream.IntStream.range(0, 50)
        .mapToObj(i -> loader.load("user-" + i, context))
        .toList();
    loader.dispatch();
    for (var future : futures) {
      future.get(5, TimeUnit.SECONDS);
    }

    ArgumentCaptor<ListUsersByIdsRequest> captor = ArgumentCaptor.forClass(
      ListUsersByIdsRequest.class
    );
    verify(stub, times(1)).listUsersByIds(captor.capture());

    ListUsersByIdsRequest sent = captor.getValue();
    assertThat(sent.getUserIdsList()).hasSize(50);
    assertThat(sent.getOrganizationId()).isEqualTo(context.organizationId());
  }

  @Test
  void twoConcurrentCallersNeverShareContextOnThePooledThread()
    throws Exception {
    UserServiceGrpc.UserServiceBlockingStub stub = mockedStub();
    when(stub.listUsersByIds(any())).thenReturn(
      ListUsersByIdsResponse.newBuilder()
        .addSummaries(
          UserSummary.newBuilder().setUserId("shared-id").setFullName("N")
        )
        .build()
    );

    RequestContext callerA = contextFor(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "agent-a"
    );
    RequestContext callerB = contextFor(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "agent-b"
    );

    DataLoader<String, UserSummaryGqlDto> loaderA = loaderFor(stub);
    DataLoader<String, UserSummaryGqlDto> loaderB = loaderFor(stub);

    CompletableFuture<UserSummaryGqlDto> futureA = loaderA.load(
      "shared-id",
      callerA
    );
    CompletableFuture<UserSummaryGqlDto> futureB = loaderB.load(
      "shared-id",
      callerB
    );

    CompletableFuture.allOf(
      CompletableFuture.runAsync(loaderA::dispatch),
      CompletableFuture.runAsync(loaderB::dispatch)
    ).get(5, TimeUnit.SECONDS);
    futureA.get(5, TimeUnit.SECONDS);
    futureB.get(5, TimeUnit.SECONDS);

    ArgumentCaptor<ListUsersByIdsRequest> captor = ArgumentCaptor.forClass(
      ListUsersByIdsRequest.class
    );
    verify(stub, times(2)).listUsersByIds(captor.capture());

    List<String> organizationIdsSeen = captor
      .getAllValues()
      .stream()
      .map(ListUsersByIdsRequest::getOrganizationId)
      .sorted()
      .toList();

    // Each call's organization id is exactly ONE of the two callers' own —
    // never the other's, and never a mix (the pooled-thread leak this row
    // exists to catch would show up as a wrong or missing value here).
    assertThat(organizationIdsSeen).containsExactlyInAnyOrder(
      callerA.organizationId(),
      callerB.organizationId()
    );
  }
}
