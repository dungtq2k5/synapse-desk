package com.synapsedesk.gateway.common.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.lang.reflect.Method;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.HandlerMapping;

/** The rule: a path variable named {@code id} or {@code <x>Id} must be a UUID. */
class PathIdInterceptorTest {

  private static final String UUID_VALUE =
    "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

  private final PathIdInterceptor interceptor = new PathIdInterceptor();

  public void handler() {}

  private boolean visit(Map<String, String> variables) throws Exception {
    Method method = PathIdInterceptorTest.class.getMethod("handler");
    MockHttpServletRequest request = new MockHttpServletRequest();
    request.setAttribute(
      HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE,
      variables
    );

    return interceptor.preHandle(
      request,
      new MockHttpServletResponse(),
      new HandlerMethod(this, method)
    );
  }

  @Test
  void aUuidIdPasses() {
    assertThatCode(() ->
      assertThat(visit(Map.of("id", UUID_VALUE))).isTrue()
    ).doesNotThrowAnyException();
  }

  @Test
  void aMalformedIdIsA400() {
    assertThatThrownBy(() ->
      visit(Map.of("id", "not-a-uuid"))
    ).isInstanceOfSatisfying(ResponseStatusException.class, refusal ->
      assertThat(refusal.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST)
    );
  }

  @Test
  void aSuffixedIdNameIsCheckedToo() {
    assertThatThrownBy(() -> visit(Map.of("ticketId", "42"))).isInstanceOf(
      ResponseStatusException.class
    );
    assertThatThrownBy(() -> visit(Map.of("flagId", ""))).isInstanceOf(
      ResponseStatusException.class
    );
  }

  @Test
  void aVariableThatIsNotAnIdIsLeftAlone() throws Exception {
    // `token` and `ticketNumber` are not ids, and neither is a name that merely
    // contains "id" without being one.
    assertThat(
      visit(Map.of("token", "x", "ticketNumber", "7", "valid", "y"))
    ).isTrue();
  }

  @Test
  void aRouteWithNoPathVariablesPasses() throws Exception {
    Method method = PathIdInterceptorTest.class.getMethod("handler");

    assertThat(
      interceptor.preHandle(
        new MockHttpServletRequest(),
        new MockHttpServletResponse(),
        new HandlerMethod(this, method)
      )
    ).isTrue();
  }
}
