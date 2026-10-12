package com.synapsedesk.gateway.modules.tickets;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.synapsedesk.gateway.common.auth.RequestContext;
import com.synapsedesk.gateway.modules.tickets.dto.rest.MessageResponseDto;
import com.synapsedesk.gateway.modules.tickets.dto.rest.TicketResponseDto;
import io.grpc.Status;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import synapsedesk.auth.Department.DepartmentResponse;
import synapsedesk.auth.Department.ListDepartmentsByIdsRequest;
import synapsedesk.auth.Department.ListDepartmentsByIdsResponse;
import synapsedesk.auth.DepartmentServiceGrpc;
import synapsedesk.auth.User.ListUsersByIdsRequest;
import synapsedesk.auth.User.ListUsersByIdsResponse;
import synapsedesk.auth.User.UserProjection;
import synapsedesk.auth.User.UserSummary;
import synapsedesk.auth.UserServiceGrpc;

/**
 * {@link TicketReferences}: one lookup of each kind per response, names filled from
 * it, and {@code null} wherever a lookup fails or an id resolves to nothing.
 */
class TicketReferencesTest {

  private static final RequestContext CALLER = new RequestContext(
    "u-caller",
    "org-1",
    false,
    List.of(),
    List.of(),
    true,
    "127.0.0.1",
    "test"
  );

  private final UserServiceGrpc.UserServiceBlockingStub users = mock(
    UserServiceGrpc.UserServiceBlockingStub.class
  );
  private final DepartmentServiceGrpc.DepartmentServiceBlockingStub departments =
    mock(DepartmentServiceGrpc.DepartmentServiceBlockingStub.class);
  private final TicketReferences references = new TicketReferences(
    users,
    departments
  );

  @BeforeEach
  void stubsPassThroughTheirDecorators() {
    when(users.withDeadlineAfter(anyLong(), any())).thenReturn(users);
    when(users.withInterceptors(any())).thenReturn(users);
    when(departments.withDeadlineAfter(anyLong(), any())).thenReturn(
      departments
    );
    when(departments.withInterceptors(any())).thenReturn(departments);
  }

  private static UserSummary summary(String id, String name) {
    return UserSummary.newBuilder().setUserId(id).setFullName(name).build();
  }

  private static TicketResponseDto ticket(
    String author,
    String assignee,
    String department
  ) {
    return new TicketResponseDto()
      .authorId(author)
      .currentAssigneeId(assignee)
      .currentDepartmentId(department);
  }

  @Test
  void aPageOfTwentyTicketsCostsOneUsersCallAndOneDepartmentsCall() {
    when(users.listUsersByIds(any())).thenReturn(
      ListUsersByIdsResponse.newBuilder()
        .addSummaries(summary("u1", "Ada Lovelace"))
        .addSummaries(summary("u2", "Grace Hopper"))
        .build()
    );
    when(departments.listDepartmentsByIds(any())).thenReturn(
      ListDepartmentsByIdsResponse.newBuilder()
        .addItems(
          DepartmentResponse.newBuilder().setId("d1").setName("Support")
        )
        .build()
    );
    List<TicketResponseDto> page = new ArrayList<>();
    for (int i = 0; i < 20; i++) page.add(ticket("u1", "u2", "d1"));

    references.fillTickets(CALLER, page);

    ArgumentCaptor<ListUsersByIdsRequest> asked = ArgumentCaptor.forClass(
      ListUsersByIdsRequest.class
    );
    verify(users, times(1)).listUsersByIds(asked.capture());
    verify(departments, times(1)).listDepartmentsByIds(
      any(ListDepartmentsByIdsRequest.class)
    );
    // The distinct ids, the caller's tenant, inactive users included, summaries.
    assertThat(asked.getValue().getUserIdsList()).containsExactly("u1", "u2");
    assertThat(asked.getValue().getOrganizationId()).isEqualTo("org-1");
    assertThat(asked.getValue().getIncludeInactive()).isTrue();
    assertThat(asked.getValue().getProjection()).isEqualTo(
      UserProjection.USER_PROJECTION_SUMMARY
    );
    assertThat(page).allSatisfy(row -> {
      assertThat(row.getAuthor().fullName()).isEqualTo("Ada Lovelace");
      assertThat(row.getAssignee().fullName()).isEqualTo("Grace Hopper");
      assertThat(row.getDepartment().name()).isEqualTo("Support");
    });
  }

  @Test
  void anUnassignedTicketHasNoAssigneeAndAnUnknownIdHasNoName() {
    when(users.listUsersByIds(any())).thenReturn(
      ListUsersByIdsResponse.newBuilder().build()
    );
    TicketResponseDto row = ticket("u-deleted", null, null);

    references.fillTickets(CALLER, List.of(row));

    assertThat(row.getAuthor()).isNull();
    assertThat(row.getAssignee()).isNull();
    assertThat(row.getDepartment()).isNull();
    verify(departments, never()).listDepartmentsByIds(any());
  }

  @Test
  void aFailedLookupLeavesTheNamesNullAndDoesNotThrow() {
    when(users.listUsersByIds(any())).thenThrow(
      Status.UNAVAILABLE.asRuntimeException()
    );
    when(departments.listDepartmentsByIds(any())).thenThrow(
      Status.UNAVAILABLE.asRuntimeException()
    );
    TicketResponseDto row = ticket("u1", "u2", "d1");

    references.fillTickets(CALLER, List.of(row));

    assertThat(row.getAuthor()).isNull();
    assertThat(row.getAssignee()).isNull();
    assertThat(row.getDepartment()).isNull();
  }

  @Test
  void aHumanMessageNamesItsSenderAndAnAiMessageHasNone() {
    when(users.listUsersByIds(any())).thenReturn(
      ListUsersByIdsResponse.newBuilder()
        .addSummaries(summary("u1", "Ada Lovelace"))
        .build()
    );
    MessageResponseDto human = new MessageResponseDto()
      .senderId("u1")
      .isAiGenerated(false);
    MessageResponseDto ai = new MessageResponseDto()
      .senderId(null)
      .isAiGenerated(true);

    references.fillMessages(CALLER, List.of(human, ai));

    assertThat(human.getSender().fullName()).isEqualTo("Ada Lovelace");
    assertThat(ai.getSender()).isNull();
    verify(users, times(1)).listUsersByIds(any());
  }
}
