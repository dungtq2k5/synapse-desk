package com.synapsedesk.gateway.audit;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.auth.SuperAdminCheck;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.server.ResponseStatusException;
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
    controller = new PlatformAuditLogsController(
      stub,
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
        "ASC",
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
}
