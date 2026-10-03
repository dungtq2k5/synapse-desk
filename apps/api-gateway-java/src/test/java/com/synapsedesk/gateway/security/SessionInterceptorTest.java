package com.synapsedesk.gateway.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.openapi.RouteSecurity;
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
  private final SessionInterceptor interceptor = new SessionInterceptor(
    currentUser,
    enrolment
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
