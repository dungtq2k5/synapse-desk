package com.synapsedesk.gateway.twofactor;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.synapsedesk.gateway.auth.CookieWriter;
import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.JwtPrincipal;
import com.synapsedesk.gateway.auth.JwtVerifier;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.auth.RequestOrigin;
import com.synapsedesk.gateway.model.ActivateTwoFactorDto;
import com.synapsedesk.gateway.model.AuthenticateTwoFactorDto;
import com.synapsedesk.gateway.security.TwoFactorEnrolmentGuard;
import jakarta.servlet.http.HttpServletResponse;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.server.ResponseStatusException;
import synapsedesk.auth.TwoFactor.ActivateTwoFactorResponse;
import synapsedesk.auth.TwoFactor.AuthenticateTwoFactorResponse;
import synapsedesk.auth.TwoFactorAuthServiceGrpc;

/**
 * `TwoFactorAuthApi` — the two handler-body auth doors: {@code
 * generate}/{@code activate}'s "full session OR verified challenge cookie"
 * ({@code requireEnrollee}), and {@code authenticate}'s "challenge cookie
 * ONLY, never an access token" ({@code requireTwoFactorToken}).
 */
class TwoFactorAuthControllerTest {

  private final TwoFactorAuthServiceGrpc.TwoFactorAuthServiceBlockingStub stub =
    mock(TwoFactorAuthServiceGrpc.TwoFactorAuthServiceBlockingStub.class);
  private final CurrentUser currentUser = mock(CurrentUser.class);
  private final JwtVerifier verifier = mock(JwtVerifier.class);
  private final CookieWriter cookies = mock(CookieWriter.class);
  private TwoFactorAuthController controller;

  @BeforeEach
  void setUp() {
    when(stub.withDeadlineAfter(anyLong(), any())).thenReturn(stub);
    when(stub.withInterceptors(any())).thenReturn(stub);
    RequestContextHolder.setRequestAttributes(
      new ServletRequestAttributes(
        new MockHttpServletRequest(),
        mock(HttpServletResponse.class)
      )
    );
    controller = new TwoFactorAuthController(
      stub,
      currentUser,
      verifier,
      cookies,
      new TwoFactorEnrolmentGuard(currentUser, cookies, verifier)
    );
  }

  @AfterEach
  void tearDown() {
    RequestContextHolder.resetRequestAttributes();
  }

  @Test
  void enrolmentTriesTheFullSessionFirst() {
    when(currentUser.read(any())).thenReturn(
      Optional.of(
        new RequestContext(
          "user-1",
          "org-1",
          false,
          List.of(),
          List.of(),
          true,
          "127.0.0.1",
          "test"
        )
      )
    );
    when(stub.activateTwoFactor(any())).thenReturn(
      ActivateTwoFactorResponse.newBuilder().addBackupCodes("code-1").build()
    );

    controller.twoFactorAuthControllerActivateV1(
      new ActivateTwoFactorDto("123456")
    );

    org.mockito.ArgumentCaptor<synapsedesk.auth.TwoFactor.ActivateTwoFactorRequest> captor =
      org.mockito.ArgumentCaptor.forClass(
        synapsedesk.auth.TwoFactor.ActivateTwoFactorRequest.class
      );
    verify(stub).activateTwoFactor(captor.capture());
    assertThat(captor.getValue().getUserId()).isEqualTo("user-1");
    verify(verifier, never()).verifyTwoFactor(any());
  }

  @Test
  void enrolmentFallsBackToAVerifiedChallengeCookie() {
    when(currentUser.read(any())).thenReturn(Optional.empty());
    when(cookies.readTwoFactorToken(any())).thenReturn(
      Optional.of("challenge-tok")
    );
    when(verifier.verifyTwoFactor("challenge-tok")).thenReturn(
      Optional.of(
        new JwtPrincipal(
          "user-2",
          null,
          false,
          List.of(),
          List.of(),
          false,
          true
        )
      )
    );
    when(currentUser.origin(any())).thenReturn(
      new RequestOrigin("127.0.0.1", "test")
    );
    when(stub.activateTwoFactor(any())).thenReturn(
      ActivateTwoFactorResponse.newBuilder().addBackupCodes("code-1").build()
    );

    controller.twoFactorAuthControllerActivateV1(
      new ActivateTwoFactorDto("123456")
    );

    org.mockito.ArgumentCaptor<synapsedesk.auth.TwoFactor.ActivateTwoFactorRequest> captor =
      org.mockito.ArgumentCaptor.forClass(
        synapsedesk.auth.TwoFactor.ActivateTwoFactorRequest.class
      );
    verify(stub).activateTwoFactor(captor.capture());
    assertThat(captor.getValue().getUserId()).isEqualTo("user-2");
  }

  @Test
  void enrolmentRefusesWhenNeitherDoorHolds() {
    when(currentUser.read(any())).thenReturn(Optional.empty());
    when(cookies.readTwoFactorToken(any())).thenReturn(Optional.empty());

    assertThatThrownBy(() ->
      controller.twoFactorAuthControllerActivateV1(
        new ActivateTwoFactorDto("123456")
      )
    )
      .isInstanceOf(ResponseStatusException.class)
      .hasMessageContaining(
        "requires a valid session or a live login challenge"
      );

    verify(stub, never()).activateTwoFactor(any());
  }

  @Test
  void authenticateNeverFallsBackToAFullSession() {
    // Even a caller WITH a valid full session is refused if they present no
    // 2FA-challenge cookie: `authenticate` never consults `currentUser` at all.
    when(cookies.readTwoFactorToken(any())).thenReturn(Optional.empty());

    AuthenticateTwoFactorDto dto = new AuthenticateTwoFactorDto();
    dto.setCode("123456");

    assertThatThrownBy(() ->
      controller.twoFactorAuthControllerAuthenticateV1(dto)
    ).isInstanceOf(ResponseStatusException.class);

    verify(stub, never()).authenticateTwoFactor(any());
    verify(currentUser, never()).read(any());
  }

  @Test
  void authenticateRefusesATokenThatFailsCryptographicVerification() {
    when(cookies.readTwoFactorToken(any())).thenReturn(
      Optional.of("forged-tok")
    );
    when(verifier.verifyTwoFactor("forged-tok")).thenReturn(Optional.empty());

    AuthenticateTwoFactorDto dto = new AuthenticateTwoFactorDto();
    dto.setCode("123456");

    assertThatThrownBy(() ->
      controller.twoFactorAuthControllerAuthenticateV1(dto)
    ).isInstanceOf(ResponseStatusException.class);

    verify(stub, never()).authenticateTwoFactor(any());
  }

  @Test
  void authenticateClearsTheChallengeCookieBeforeSettingTheSessionOnes() {
    when(cookies.readTwoFactorToken(any())).thenReturn(
      Optional.of("valid-tok")
    );
    when(verifier.verifyTwoFactor("valid-tok")).thenReturn(
      Optional.of(
        new JwtPrincipal(
          "user-3",
          null,
          false,
          List.of(),
          List.of(),
          false,
          true
        )
      )
    );
    when(currentUser.origin(any())).thenReturn(
      new RequestOrigin("127.0.0.1", "test")
    );
    when(stub.authenticateTwoFactor(any())).thenReturn(
      AuthenticateTwoFactorResponse.newBuilder()
        .setAccessToken("access-1")
        .setRefreshToken("refresh-1")
        .setUser(
          synapsedesk.auth.Common.UserResponse.newBuilder()
            .setId(java.util.UUID.randomUUID().toString())
            .setEmail("a@b.com")
            .setFullName("Ada Lovelace")
            .build()
        )
        .build()
    );

    AuthenticateTwoFactorDto dto = new AuthenticateTwoFactorDto();
    dto.setCode("123456");

    controller.twoFactorAuthControllerAuthenticateV1(dto);

    org.mockito.InOrder order = org.mockito.Mockito.inOrder(cookies);
    order.verify(cookies).clearTwoFactorToken(any());
    order
      .verify(cookies)
      .setAccessToken(any(), org.mockito.ArgumentMatchers.eq("access-1"));
    order
      .verify(cookies)
      .setRefreshToken(any(), org.mockito.ArgumentMatchers.eq("refresh-1"));
    verify(cookies, never()).setDeviceToken(any(), any());
  }
}
