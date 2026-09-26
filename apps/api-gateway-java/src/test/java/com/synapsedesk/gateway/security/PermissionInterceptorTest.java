package com.synapsedesk.gateway.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.config.RuntimeProperties;
import com.synapsedesk.gateway.generated.model.CurrentUserResponseDto.PermissionCodesEnum;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.server.ResponseStatusException;

/**
 * `PermissionInterceptor`, against a stand-in controller — no HTTP, no
 * Spring context, since what is under test is the enforcement logic itself,
 * not the wiring. {@link com.synapsedesk.gateway.feedback.FeedbackController}
 * exercises the real annotation over real HTTP (`feedback.contract-spec.ts`'s
 * two permission rows); this covers what that single route cannot: the
 * super-admin bypass and the ANY-of-multiple semantics, neither of which
 * `analytics.read` alone can distinguish from "requires exactly this one".
 */
class PermissionInterceptorTest {

  private final CurrentUser currentUser = mock(CurrentUser.class);
  private final HttpServletRequest request = mock(HttpServletRequest.class);
  private final HttpServletResponse response = mock(HttpServletResponse.class);

  private final RuntimeProperties development =
      new RuntimeProperties("development", 0, "/api", false, "1.0.0", "sha", "time");
  private final RuntimeProperties production =
      new RuntimeProperties("production", 0, "/api", false, "1.0.0", "sha", "time");

  @RequirePermission(PermissionCodesEnum.ANALYTICS_READ)
  private void singleCode() {}

  @RequirePermission({PermissionCodesEnum.TICKET_ASSIGN, PermissionCodesEnum.TICKET_ASSIGN_SELF})
  private void eitherCode() {}

  private void noAnnotation() {}

  @Test
  void noAnnotationAllowsWithoutEvenReadingTheCaller() throws NoSuchMethodException {
    PermissionInterceptor interceptor = new PermissionInterceptor(currentUser, development);

    assertThat(interceptor.preHandle(request, response, handlerFor("noAnnotation"))).isTrue();
    // Not just "it allowed" — it never called `require`, so an unannotated
    // route works even with no session bound to the request, matching
    // `PermissionGuard.canActivate`'s early `return true` before it ever
    // reads the caller.
    verifyNoInteractions(currentUser);
  }

  @Test
  void missingThePermissionIs403WithTheDevMessage() throws NoSuchMethodException {
    PermissionInterceptor interceptor = new PermissionInterceptor(currentUser, development);
    when(currentUser.require(request)).thenReturn(context(false, List.of()));

    assertThatThrownBy(() -> interceptor.preHandle(request, response, handlerFor("singleCode")))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("Requires one of: analytics.read");
  }

  @Test
  void theSameRefusalIsGenericInProduction() throws NoSuchMethodException {
    PermissionInterceptor interceptor = new PermissionInterceptor(currentUser, production);
    when(currentUser.require(request)).thenReturn(context(false, List.of()));

    assertThatThrownBy(() -> interceptor.preHandle(request, response, handlerFor("singleCode")))
        .hasMessageContaining("You do not have permission to access this resource")
        .hasMessageNotContaining("analytics.read");
  }

  @Test
  void aSuperAdminBypassesEvenHoldingNoneOfTheCodes() throws NoSuchMethodException {
    PermissionInterceptor interceptor = new PermissionInterceptor(currentUser, development);
    when(currentUser.require(request)).thenReturn(context(true, List.of()));

    assertThat(interceptor.preHandle(request, response, handlerFor("singleCode"))).isTrue();
  }

  @Test
  void eitherCodeOfAnAnyOfPairGrants() throws NoSuchMethodException {
    PermissionInterceptor interceptor = new PermissionInterceptor(currentUser, development);
    // Holds ONLY the second of the two codes `eitherCode` declares — a
    // guard that (wrongly) checked just the first would refuse this.
    when(currentUser.require(request)).thenReturn(context(false, List.of("ticket.assign.self")));

    assertThat(interceptor.preHandle(request, response, handlerFor("eitherCode"))).isTrue();
  }

  private RequestContext context(boolean superAdmin, List<String> permissionCodes) {
    return new RequestContext(
        "22222222-2222-4222-8222-222222222222",
        "11111111-1111-4111-8111-111111111111",
        superAdmin,
        List.of(),
        permissionCodes,
        true,
        "127.0.0.1",
        "test-agent");
  }

  private HandlerMethod handlerFor(String methodName) throws NoSuchMethodException {
    return new HandlerMethod(this, getClass().getDeclaredMethod(methodName));
  }
}
