package com.synapsedesk.gateway.tickets;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.graphql.UserSummaryGqlDto;
import com.synapsedesk.gateway.graphql.UsersLoaderConfig;
import graphql.GraphQLContext;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.dataloader.DataLoader;
import org.dataloader.DataLoaderRegistry;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.graphql.execution.DefaultBatchLoaderRegistry;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import synapsedesk.auth.User.ListUsersByIdsRequest;
import synapsedesk.auth.User.ListUsersByIdsResponse;
import synapsedesk.auth.User.UserSummary;
import synapsedesk.auth.UserServiceGrpc;

/**
 * `TicketMessage.sender`, real resolver + real loader, mocked only at the
 * gRPC stub — the batching row this loader contract asks for: a loader removed here
 * would resolve N+1 times, and this must go red on CALL COUNT, not on data.
 */
class TicketMessagesResolverTest {

  private static RequestContext context() {
    return new RequestContext(
      "agent-1",
      "11111111-1111-4111-8111-111111111111",
      false,
      List.of(),
      List.of(),
      true,
      "127.0.0.1",
      "test"
    );
  }

  private static TicketMessageGqlDto message(String id, String senderId) {
    return new TicketMessageGqlDto(
      id,
      "ticket-1",
      senderId,
      "content",
      false,
      false,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    );
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
  void threeMessagesFromDifferentSendersProduceExactlyOneBatchCall()
    throws Exception {
    RequestContextHolder.setRequestAttributes(
      new ServletRequestAttributes(mock(HttpServletRequest.class))
    );
    try {
      UserServiceGrpc.UserServiceBlockingStub stub = mock(
        UserServiceGrpc.UserServiceBlockingStub.class
      );
      when(stub.withDeadlineAfter(anyLong(), any())).thenReturn(stub);
      when(stub.withInterceptors(any())).thenReturn(stub);
      when(stub.listUsersByIds(any())).thenAnswer(invocation -> {
        ListUsersByIdsRequest request = invocation.getArgument(0);
        return ListUsersByIdsResponse.newBuilder()
          .addAllSummaries(
            request
              .getUserIdsList()
              .stream()
              .map(id ->
                UserSummary.newBuilder()
                  .setUserId(id)
                  .setFullName("Ada")
                  .build()
              )
              .toList()
          )
          .build();
      });

      DataLoader<String, UserSummaryGqlDto> loader = loaderFor(stub);
      CurrentUser currentUser = mock(CurrentUser.class);
      when(currentUser.require(any())).thenReturn(context());

      TicketMessagesResolver resolver = new TicketMessagesResolver(currentUser);

      List<CompletableFuture<UserSummaryGqlDto>> futures = List.of(
        resolver.sender(message("m1", "agent-1"), loader),
        resolver.sender(message("m2", "agent-2"), loader),
        resolver.sender(message("m3", "agent-3"), loader)
      );
      loader.dispatch();
      for (var future : futures) {
        assertThat(future.get(5, TimeUnit.SECONDS).fullName()).isEqualTo("Ada");
      }

      ArgumentCaptor<ListUsersByIdsRequest> captor = ArgumentCaptor.forClass(
        ListUsersByIdsRequest.class
      );
      verify(stub, times(1)).listUsersByIds(captor.capture());
      assertThat(captor.getValue().getUserIdsList()).hasSize(3);
    } finally {
      RequestContextHolder.resetRequestAttributes();
    }
  }

  @Test
  void aNullSenderIdResolvesNullWithNoLoaderCall() throws Exception {
    UserServiceGrpc.UserServiceBlockingStub stub = mock(
      UserServiceGrpc.UserServiceBlockingStub.class
    );
    DataLoader<String, UserSummaryGqlDto> loader = loaderFor(stub);
    TicketMessagesResolver resolver = new TicketMessagesResolver(
      mock(CurrentUser.class)
    );

    CompletableFuture<UserSummaryGqlDto> result = resolver.sender(
      message("m1", null),
      loader
    );

    assertThat(result.get(1, TimeUnit.SECONDS)).isNull();
    verifyNoInteractions(stub);
  }
}
