package com.synapsedesk.gateway.common.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.synapsedesk.gateway.common.auth.CurrentUser;
import com.synapsedesk.gateway.common.auth.RequestContext;
import com.synapsedesk.gateway.common.auth.SuperAdminCheck;
import com.synapsedesk.gateway.common.openapi.RouteSecurity;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.server.ResponseStatusException;

/**
 * The rule: a handler of ours is refused for lack of a session unless it carries
 * {@link RouteSecurity}; nothing outside the application is gated.
 */
class SessionInterceptorTest {

  private final CurrentUser currentUser = mock(CurrentUser.class);
  private final TwoFactorEnrolmentGuard enrolment = mock(
    TwoFactorEnrolmentGuard.class
  );
  private final SuperAdminCheck superAdmin = mock(SuperAdminCheck.class);
  private final SessionInterceptor interceptor = new SessionInterceptor(
    currentUser,
    enrolment,
    superAdmin
  );
  private final MockHttpServletRequest request = new MockHttpServletRequest();
  private final MockHttpServletResponse response =
    new MockHttpServletResponse();

  static class Handlers {

    public void secured() {}

    @RouteSecurity(RouteSecurity.Scheme.NONE)
    public void open() {}

    @RouteSecurity(RouteSecurity.Scheme.SESSION_OR_CHALLENGE)
    public void either() {}

    @RequireVerifiedEmail
    public void sendsMail() {}
  }

  @SuperAdminOnly
  static class PlatformHandlers {

    public void secured() {}
  }

  private HandlerMethod handler(String name) throws Exception {
    return new HandlerMethod(new Handlers(), Handlers.class.getMethod(name));
  }

  @Test
  void anUnmarkedHandlerRequiresASession() throws Exception {
    when(currentUser.require(any())).thenThrow(
      new ResponseStatusException(
        org.springframework.http.HttpStatus.UNAUTHORIZED
      )
    );

    assertThatThrownBy(() ->
      interceptor.preHandle(request, response, handler("secured"))
    ).isInstanceOf(ResponseStatusException.class);
  }

  @Test
  void aSignedInCallerPasses() throws Exception {
    when(currentUser.require(any())).thenReturn(mock(RequestContext.class));

    assertThat(
      interceptor.preHandle(request, response, handler("secured"))
    ).isTrue();
    verify(currentUser).require(request);
  }

  @Test
  void aMarkedHandlerIsNotAskedForASession() throws Exception {
    assertThat(
      interceptor.preHandle(request, response, handler("open"))
    ).isTrue();
    verify(currentUser, never()).require(any());
  }

  @Test
  void aRouteThatAdmitsEitherCredentialAsksTheEnrolmentGuardAndNotTheSession()
    throws Exception {
    assertThat(
      interceptor.preHandle(request, response, handler("either"))
    ).isTrue();
    verify(enrolment).require(request);
    verify(currentUser, never()).require(any());
  }

  @Test
  void aCallerWithNeitherCredentialIsRefusedByTheEnrolmentGuard()
    throws Exception {
    when(enrolment.require(any())).thenThrow(
      new ResponseStatusException(
        org.springframework.http.HttpStatus.UNAUTHORIZED
      )
    );

    assertThatThrownBy(() ->
      interceptor.preHandle(request, response, handler("either"))
    ).isInstanceOf(ResponseStatusException.class);
  }

  @Test
  void aSuperAdminOnlyControllerAsksTheSuperAdminCheckAfterTheSession()
    throws Exception {
    RequestContext context = mock(RequestContext.class);
    when(currentUser.require(any())).thenReturn(context);

    assertThat(
      interceptor.preHandle(
        request,
        response,
        new HandlerMethod(
          new PlatformHandlers(),
          PlatformHandlers.class.getMethod("secured")
        )
      )
    ).isTrue();
    verify(superAdmin).require(context);
  }

  @Test
  void anOrdinaryControllerIsNotAskedForSuperAdmin() throws Exception {
    when(currentUser.require(any())).thenReturn(mock(RequestContext.class));

    interceptor.preHandle(request, response, handler("secured"));

    verify(superAdmin, never()).require(any());
  }

  private static RequestContext caller(boolean superAdmin, boolean verified) {
    return new RequestContext(
      "user-1",
      superAdmin ? null : "org-1",
      superAdmin,
      List.of(),
      List.of(),
      verified,
      "127.0.0.1",
      "agent"
    );
  }

  @Test
  void anUnverifiedCallerIsRefusedWith403OnARouteThatNeedsAVerifiedEmail()
    throws Exception {
    when(currentUser.require(any())).thenReturn(caller(false, false));

    assertThatThrownBy(() ->
      interceptor.preHandle(request, response, handler("sendsMail"))
    )
      .isInstanceOf(ResponseStatusException.class)
      .hasMessageContaining("Verify your email address");
  }

  @Test
  void aVerifiedCallerAndASuperAdminPassARouteThatNeedsAVerifiedEmail()
    throws Exception {
    when(currentUser.require(any())).thenReturn(caller(false, true));
    assertThat(
      interceptor.preHandle(request, response, handler("sendsMail"))
    ).isTrue();

    when(currentUser.require(any())).thenReturn(caller(true, false));
    assertThat(
      interceptor.preHandle(request, response, handler("sendsMail"))
    ).isTrue();
  }

  @Test
  void anUnverifiedCallerPassesARouteThatDoesNotAskForOne() throws Exception {
    when(currentUser.require(any())).thenReturn(caller(false, false));

    assertThat(
      interceptor.preHandle(request, response, handler("secured"))
    ).isTrue();
  }

  @Test
  void aHandlerOutsideTheApplicationIsNotGated() throws Exception {
    HandlerMethod foreign = new HandlerMethod(
      "text",
      String.class.getMethod("length")
    );

    assertThat(interceptor.preHandle(request, response, foreign)).isTrue();
    verify(currentUser, never()).require(any());
  }

  @Test
  void aNonHandlerMethodPasses() {
    assertThat(interceptor.preHandle(request, response, "a resource")).isTrue();
    verify(currentUser, never()).require(any());
  }
}
