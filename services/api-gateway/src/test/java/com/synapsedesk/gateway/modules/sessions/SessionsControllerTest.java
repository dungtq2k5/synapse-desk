package com.synapsedesk.gateway.modules.sessions;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.synapsedesk.gateway.common.auth.CookieWriter;
import com.synapsedesk.gateway.common.auth.CurrentUser;
import com.synapsedesk.gateway.common.auth.RequestContext;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import synapsedesk.auth.Session.RevokeSessionResponse;
import synapsedesk.auth.SessionServiceGrpc;

/**
 * `SessionsController.revoke`'s cookie-clearing. The property under test is that
 * cookies clear if and ONLY IF the revoked family was the caller's own
 * ({@code wasCurrent}), which auth-service reports because the gateway never
 * sees a family id and cannot work this out for itself.
 */
class SessionsControllerTest {

  private final SessionServiceGrpc.SessionServiceBlockingStub stub = mock(
    SessionServiceGrpc.SessionServiceBlockingStub.class
  );
  private final CurrentUser currentUser = mock(CurrentUser.class);
  private final CookieWriter cookies = mock(CookieWriter.class);
  private SessionsController controller;

  @BeforeEach
  void setUp() {
    when(stub.withDeadlineAfter(anyLong(), any())).thenReturn(stub);
    when(stub.withInterceptors(any())).thenReturn(stub);
    when(currentUser.require(any())).thenReturn(
      new RequestContext(
        "agent-1",
        "org-1",
        false,
        List.of(),
        List.of(),
        true,
        "127.0.0.1",
        "test"
      )
    );
    when(cookies.readRefreshToken(any())).thenReturn(Optional.empty());
    RequestContextHolder.setRequestAttributes(
      new ServletRequestAttributes(
        new MockHttpServletRequest(),
        mock(HttpServletResponse.class)
      )
    );
    controller = new SessionsController(stub, currentUser, cookies);
  }

  @AfterEach
  void tearDown() {
    RequestContextHolder.resetRequestAttributes();
  }

  @Test
  void revokingTheCurrentSessionClearsBothCookieGroups() {
    when(stub.revokeSession(any())).thenReturn(
      RevokeSessionResponse.newBuilder()
        .setWasCurrent(true)
        .setRevokedCount(2)
        .build()
    );

    controller.sessionsControllerRevokeV1("session-1");

    verify(cookies).clearSession(any());
    verify(cookies).clearDeviceToken(any());
  }

  @Test
  void revokingAnotherSessionClearsNoCookies() {
    when(stub.revokeSession(any())).thenReturn(
      RevokeSessionResponse.newBuilder()
        .setWasCurrent(false)
        .setRevokedCount(1)
        .build()
    );

    controller.sessionsControllerRevokeV1("session-2");

    verify(cookies, never()).clearSession(any());
    verify(cookies, never()).clearDeviceToken(any());
  }

  @Test
  void listForwardsThePresentedRefreshTokenToMarkCurrent() {
    HttpServletRequest request = mock(HttpServletRequest.class);
    RequestContextHolder.setRequestAttributes(
      new ServletRequestAttributes(request, mock(HttpServletResponse.class))
    );
    when(cookies.readRefreshToken(request)).thenReturn(
      Optional.of("refresh-abc")
    );
    when(stub.listSessions(any())).thenReturn(
      synapsedesk.auth.Session.ListSessionsResponse.getDefaultInstance()
    );

    controller.sessionsControllerListV1();

    org.mockito.ArgumentCaptor<synapsedesk.auth.Session.ListSessionsRequest> captor =
      org.mockito.ArgumentCaptor.forClass(
        synapsedesk.auth.Session.ListSessionsRequest.class
      );
    verify(stub).listSessions(captor.capture());
    org.assertj.core.api.Assertions.assertThat(
      captor.getValue().getRefreshToken()
    ).isEqualTo("refresh-abc");
  }
}
