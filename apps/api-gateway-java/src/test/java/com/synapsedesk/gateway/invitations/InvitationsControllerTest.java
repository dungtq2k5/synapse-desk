package com.synapsedesk.gateway.invitations;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.synapsedesk.gateway.auth.CookieWriter;
import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.GuestCheck;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.model.AcceptInvitationDto;
import com.synapsedesk.gateway.security.RequirePermission;
import com.synapsedesk.gateway.web.InvitationSortField;
import com.synapsedesk.gateway.web.SortDirection;
import jakarta.servlet.http.HttpServletResponse;
import java.lang.reflect.Method;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.server.ResponseStatusException;
import synapsedesk.auth.Invitation.AcceptInvitationResponse;
import synapsedesk.auth.InvitationServiceGrpc;

/**
 * `InvitationsApi` — the two genuinely public routes ({@code previewByToken},
 * {@code accept}) and {@code accept}'s {@link GuestCheck}, ported from
 * `GuestGuard`: accepting while already holding a live session would
 * silently replace it.
 */
class InvitationsControllerTest {

  private final InvitationServiceGrpc.InvitationServiceBlockingStub stub = mock(
    InvitationServiceGrpc.InvitationServiceBlockingStub.class
  );
  private final CurrentUser currentUser = mock(CurrentUser.class);
  private final GuestCheck guestCheck = mock(GuestCheck.class);
  private final CookieWriter cookies = mock(CookieWriter.class);
  private InvitationsController controller;

  private static MockHttpServletRequest requestWithResponse() {
    return new MockHttpServletRequest();
  }

  @BeforeEach
  void setUp() {
    when(stub.withDeadlineAfter(anyLong(), any())).thenReturn(stub);
    when(stub.withInterceptors(any())).thenReturn(stub);
    RequestContextHolder.setRequestAttributes(
      new ServletRequestAttributes(
        requestWithResponse(),
        mock(HttpServletResponse.class)
      )
    );
    controller = new InvitationsController(
      stub,
      currentUser,
      guestCheck,
      cookies
    );
  }

  @AfterEach
  void tearDown() {
    RequestContextHolder.resetRequestAttributes();
  }

  @Test
  void acceptRefusesAnActiveSessionBeforeTouchingThePeer() {
    org.mockito.Mockito.doThrow(
      new ResponseStatusException(
        org.springframework.http.HttpStatus.BAD_REQUEST,
        "You are already logged in with an active session."
      )
    )
      .when(guestCheck)
      .requireNoActiveSession(any());

    AcceptInvitationDto dto = new AcceptInvitationDto(
      "tok",
      "Ada Lovelace",
      "pw12345678"
    );

    assertThatThrownBy(() ->
      controller.invitationsControllerAcceptV1(dto)
    ).isInstanceOf(ResponseStatusException.class);

    verifyNoInteractions(stub);
  }

  @Test
  void acceptSignsInOnSuccessAndSurfacesSkippedAssignmentsAsAWarning() {
    when(currentUser.origin(any())).thenReturn(
      new com.synapsedesk.gateway.auth.RequestOrigin("127.0.0.1", "test")
    );
    when(stub.acceptInvitation(any())).thenReturn(
      AcceptInvitationResponse.newBuilder()
        .setAccessToken("access-1")
        .setRefreshToken("refresh-1")
        .setUser(
          synapsedesk.auth.Common.UserResponse.newBuilder()
            .setId(java.util.UUID.randomUUID().toString())
            .setEmail("a@b.com")
            .setFullName("Ada Lovelace")
            .build()
        )
        .addSkipped("role-1")
        .build()
    );

    AcceptInvitationDto dto = new AcceptInvitationDto(
      "tok",
      "Ada Lovelace",
      "pw12345678"
    );

    var response = controller.invitationsControllerAcceptV1(dto);

    verify(cookies).setAccessToken(
      any(),
      org.mockito.ArgumentMatchers.eq("access-1")
    );
    verify(cookies).setRefreshToken(
      any(),
      org.mockito.ArgumentMatchers.eq("refresh-1")
    );
    assertThat(response.getBody().warning()).contains(
      "1 role/department assignment(s)"
    );
  }

  @Test
  void previewByTokenAndAcceptCarryNoPermissionRequirement()
    throws NoSuchMethodException {
    Method previewByToken = InvitationsController.class.getMethod(
      "invitationsControllerPreviewByTokenV1",
      String.class
    );
    Method accept = InvitationsController.class.getMethod(
      "invitationsControllerAcceptV1",
      com.synapsedesk.gateway.model.AcceptInvitationDto.class
    );

    assertThat(
      previewByToken.isAnnotationPresent(RequirePermission.class)
    ).isFalse();
    assertThat(accept.isAnnotationPresent(RequirePermission.class)).isFalse();
  }

  @Test
  void createAndResendCarryTheVerifiedEmailMarker() {
    // The mail-sending routes are the two Node puts `EmailVerifiedGuard` on. The marker is
    // the declaration; `SessionInterceptor` is the mechanism and the contract rows hold it.
    for (String name : List.of(
      "invitationsControllerCreateV1",
      "invitationsControllerResendV1"
    )) {
      assertThat(
        java.util.Arrays.stream(
          InvitationsController.class.getDeclaredMethods()
        )
          .filter(method -> method.getName().equals(name))
          .allMatch(method ->
            method.isAnnotationPresent(
              com.synapsedesk.gateway.security.RequireVerifiedEmail.class
            )
          )
      ).isTrue();
    }
  }
}
