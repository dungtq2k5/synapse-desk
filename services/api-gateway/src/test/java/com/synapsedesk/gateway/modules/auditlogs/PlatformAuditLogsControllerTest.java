package com.synapsedesk.gateway.modules.auditlogs;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.synapsedesk.gateway.common.auth.CurrentUser;
import com.synapsedesk.gateway.common.auth.RequestContext;
import com.synapsedesk.gateway.common.auth.SuperAdminCheck;
import com.synapsedesk.gateway.common.web.SortDirection;
import com.synapsedesk.gateway.modules.auditlogs.dto.rest.PlatformAuditLogResponseDto;
import io.grpc.Status;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.server.ResponseStatusException;
import synapsedesk.auth.Platform.ResolveAuditNamesResponse;
import synapsedesk.auth.PlatformServiceGrpc;
import synapsedesk.ticket.Audit.AuditAction;
import synapsedesk.ticket.Audit.AuditLogResponse;
import synapsedesk.ticket.Audit.AuditResourceType;
import synapsedesk.ticket.Audit.ListAuditLogsResponse;
import synapsedesk.ticket.AuditServiceGrpc;
import tools.jackson.databind.ObjectMapper;

/**
 * `PlatformAuditLogsApi` — {@link SuperAdminCheck} must run BEFORE the peer
 * is ever dialed, the same order property every other handler-body guard in
 * this port (`GuestCheck`, `requireEmailVerified`, `Jwt2faGuard`'s Java
 * equivalent) is held to.
 */
class PlatformAuditLogsControllerTest {

  private final AuditServiceGrpc.AuditServiceBlockingStub stub = mock(
    AuditServiceGrpc.AuditServiceBlockingStub.class
  );
  private final PlatformServiceGrpc.PlatformServiceBlockingStub platform = mock(
    PlatformServiceGrpc.PlatformServiceBlockingStub.class
  );
  private final CurrentUser currentUser = mock(CurrentUser.class);
  private final SuperAdminCheck superAdminCheck = mock(SuperAdminCheck.class);
  private PlatformAuditLogsController controller;

  @BeforeEach
  void setUp() {
    when(currentUser.require(any())).thenReturn(
      new RequestContext(
        "agent-1",
        null,
        true,
        List.of(),
        List.of(),
        true,
        "127.0.0.1",
        "test"
      )
    );
    RequestContextHolder.setRequestAttributes(
      new ServletRequestAttributes(new MockHttpServletRequest())
    );
    when(stub.withDeadlineAfter(anyLong(), any())).thenReturn(stub);
    when(stub.withInterceptors(any())).thenReturn(stub);
    when(platform.withDeadlineAfter(anyLong(), any())).thenReturn(platform);
    when(platform.withInterceptors(any())).thenReturn(platform);
    controller = new PlatformAuditLogsController(
      stub,
      platform,
      currentUser,
      superAdminCheck,
      new ObjectMapper()
    );
  }

  @AfterEach
  void tearDown() {
    RequestContextHolder.resetRequestAttributes();
  }

  @Test
  void listActionsRefusesBeforeTouchingThePeerWhenTheCheckFails() {
    doThrow(
      new ResponseStatusException(
        org.springframework.http.HttpStatus.FORBIDDEN,
        "Platform administration access required"
      )
    )
      .when(superAdminCheck)
      .require(any());

    org.assertj.core.api.Assertions.assertThatThrownBy(() ->
      controller.platformAuditLogsControllerListActionsV1()
    ).isInstanceOf(ResponseStatusException.class);

    verifyNoInteractions(stub);
  }

  @Test
  void listRefusesBeforeTouchingThePeerWhenTheCheckFails() {
    doThrow(
      new ResponseStatusException(
        org.springframework.http.HttpStatus.FORBIDDEN,
        "Platform administration access required"
      )
    )
      .when(superAdminCheck)
      .require(any());

    org.assertj.core.api.Assertions.assertThatThrownBy(() ->
      controller.platformAuditLogsControllerListV1(
        java.math.BigDecimal.ONE,
        java.math.BigDecimal.TEN,
        "createdAt",
        SortDirection.ASC,
        null,
        null,
        null,
        null,
        null,
        null
      )
    ).isInstanceOf(ResponseStatusException.class);

    verifyNoInteractions(stub);
  }

  private static final String ORG = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
  private static final String PLAN = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

  private List<PlatformAuditLogResponseDto> list() {
    return controller
      .platformAuditLogsControllerListV1(
        java.math.BigDecimal.ONE,
        java.math.BigDecimal.TEN,
        "createdAt",
        SortDirection.ASC,
        null,
        null,
        null,
        null,
        null,
        null
      )
      .getBody()
      .data()
      .items();
  }

  private void trail() {
    when(stub.listAuditLogs(any())).thenReturn(
      ListAuditLogsResponse.newBuilder()
        .addItems(
          entry(
            "log-1",
            AuditResourceType.AUDIT_RESOURCE_TYPE_ORGANIZATION,
            ORG
          )
        )
        .addItems(
          entry(
            "log-2",
            AuditResourceType.AUDIT_RESOURCE_TYPE_SUBSCRIPTION_PLAN,
            PLAN
          )
        )
        .addItems(
          entry("log-3", AuditResourceType.AUDIT_RESOURCE_TYPE_JOB, null)
        )
        .build()
    );
  }

  private static AuditLogResponse entry(
    String id,
    AuditResourceType type,
    String resourceId
  ) {
    AuditLogResponse.Builder entry = AuditLogResponse.newBuilder()
      .setId(id)
      .setUserId("agent-1")
      .setAction(AuditAction.AUDIT_ACTION_PLATFORM_JOB_RUN)
      .setResourceType(type)
      .setMetadata("{}")
      .setCreatedAt(com.google.protobuf.Timestamp.getDefaultInstance());
    if (resourceId != null) entry.setResourceId(resourceId);
    return entry.build();
  }

  @Test
  void listNamesWhoActedAndTheOrganizationOrPlanFromAuth() {
    trail();
    when(platform.resolveAuditNames(any())).thenReturn(
      ResolveAuditNamesResponse.newBuilder()
        .putUsers("agent-1", "Ravi Patel")
        .putOrganizations(ORG, "Northwind Health")
        .putPlans(PLAN, "Pro")
        .build()
    );

    List<PlatformAuditLogResponseDto> items = list();

    assertThat(items)
      .extracting(
        PlatformAuditLogResponseDto::getActorName,
        PlatformAuditLogResponseDto::getResourceName
      )
      .containsExactly(
        org.assertj.core.groups.Tuple.tuple("Ravi Patel", "Northwind Health"),
        org.assertj.core.groups.Tuple.tuple("Ravi Patel", "Pro"),
        org.assertj.core.groups.Tuple.tuple("Ravi Patel", null)
      );
    var sent = org.mockito.ArgumentCaptor.forClass(
      synapsedesk.auth.Platform.ResolveAuditNamesRequest.class
    );
    org.mockito.Mockito.verify(platform).resolveAuditNames(sent.capture());
    assertThat(sent.getValue().getUserIdsList()).containsExactly("agent-1");
    assertThat(sent.getValue().getOrganizationIdsList()).containsExactly(ORG);
    assertThat(sent.getValue().getPlanIdsList()).containsExactly(PLAN);
  }

  @Test
  void aNameLookupThatFailsLeavesTheNamesNullAndTheTrailReads() {
    trail();
    when(platform.resolveAuditNames(any())).thenThrow(
      Status.UNAVAILABLE.asRuntimeException()
    );

    List<PlatformAuditLogResponseDto> items = list();

    assertThat(items).hasSize(3);
    assertThat(items)
      .extracting(PlatformAuditLogResponseDto::getActorName)
      .containsOnlyNulls();
    assertThat(items)
      .extracting(PlatformAuditLogResponseDto::getResourceName)
      .containsOnlyNulls();
  }
}
