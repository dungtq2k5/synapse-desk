package com.synapsedesk.gateway.lifecycle;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.method.HandlerMethod;

/**
 * Who the gate asks about, and which category it asks with.
 *
 * <p>Three callers pass through untouched and none is asked about: a request with no
 * session (no tenant yet), a Super Admin (no tenant, acts ON frozen ones), and a
 * route in the AUTH category. Everything else is asked, in the category the handler
 * declares (the method's, else its controller's) or its verb's.
 */
class OrganizationLifecycleInterceptorTest {

  private static final String ORG = "99999999-9999-4999-8999-999999999999";

  static class Plain {

    public void read() {}
  }

  @OrgAccessKind(OrgAccess.BILLING)
  static class Billing {

    public void list() {}

    @OrgAccessKind(OrgAccess.AUTH)
    public void exempt() {}
  }

  private CurrentUser currentUser;
  private LifecyclePolicy policy;
  private OrganizationLifecycleInterceptor interceptor;

  @BeforeEach
  void setUp() {
    currentUser = mock(CurrentUser.class);
    policy = mock(LifecyclePolicy.class);
    interceptor = new OrganizationLifecycleInterceptor(currentUser, policy);
  }

  private static HandlerMethod handler(Object bean, String method)
    throws Exception {
    return new HandlerMethod(bean, bean.getClass().getMethod(method));
  }

  private static RequestContext member(
    String organizationId,
    boolean superAdmin
  ) {
    return new RequestContext(
      "user",
      organizationId,
      superAdmin,
      List.of(),
      List.of(),
      true,
      "",
      ""
    );
  }

  private boolean run(String httpMethod, Object handler) {
    return interceptor.preHandle(
      new MockHttpServletRequest(httpMethod, "/x"),
      new MockHttpServletResponse(),
      handler
    );
  }

  @Test
  void aRequestWithNoSessionIsNeverAskedAbout() throws Exception {
    when(currentUser.read(any())).thenReturn(Optional.empty());

    assertThat(run("GET", handler(new Plain(), "read"))).isTrue();

    verifyNoInteractions(policy);
  }

  @Test
  void aSuperAdminActsOnFrozenWorkspacesSoIsNeverGated() throws Exception {
    when(currentUser.read(any())).thenReturn(Optional.of(member(null, true)));

    assertThat(run("POST", handler(new Plain(), "read"))).isTrue();

    verifyNoInteractions(policy);
  }

  @Test
  void theSuperAdminFlagAloneExemptsEvenWithATenantOnTheToken()
    throws Exception {
    // The two conditions are independent: `isSuperAdmin || !organizationId`.
    when(currentUser.read(any())).thenReturn(Optional.of(member(ORG, true)));

    assertThat(run("POST", handler(new Plain(), "read"))).isTrue();

    verifyNoInteractions(policy);
  }

  @Test
  void aCallerWithNoTenantIsNeverGatedWhateverTheFlag() throws Exception {
    when(currentUser.read(any())).thenReturn(Optional.of(member(null, false)));
    assertThat(run("GET", handler(new Plain(), "read"))).isTrue();

    when(currentUser.read(any())).thenReturn(Optional.of(member("", false)));
    assertThat(run("GET", handler(new Plain(), "read"))).isTrue();

    verifyNoInteractions(policy);
  }

  @Test
  void aMemberIsGatedByTheirOwnTenantInTheCategoryOfTheVerb() throws Exception {
    when(currentUser.read(any())).thenReturn(Optional.of(member(ORG, false)));

    run("GET", handler(new Plain(), "read"));
    run("POST", handler(new Plain(), "read"));

    verify(policy).require(ORG, OrgAccess.READ);
    verify(policy).require(ORG, OrgAccess.WRITE);
  }

  @Test
  void aDeclaredCategoryBeatsTheVerbAndAMethodBeatsItsController()
    throws Exception {
    when(currentUser.read(any())).thenReturn(Optional.of(member(ORG, false)));

    run("POST", handler(new Billing(), "list"));
    run("POST", handler(new Billing(), "exempt"));

    verify(policy).require(ORG, OrgAccess.BILLING);
    verify(policy).require(ORG, OrgAccess.AUTH);
  }

  @Test
  void theGeneratedDocumentationAndTheErrorDispatchAreNotRoutesAndAreNeverGated()
    throws Exception {
    Class<?> docs = Class.forName(
      "org.springdoc.webmvc.api.OpenApiWebMvcResource"
    );
    HandlerMethod documentation = new HandlerMethod(
      mock(docs),
      docs.getMethods()[0]
    );
    when(currentUser.read(any())).thenReturn(Optional.of(member(ORG, false)));

    assertThat(run("GET", documentation)).isTrue();

    verify(currentUser, never()).read(any());
    verify(policy, never()).require(anyString(), any());
  }

  @Test
  void aHandlerThatIsNotAnMvcMethodIsLeftToItsOwnGate() {
    // GraphQL is gated by the aspect on its resolvers, not here.
    assertThat(run("POST", (Runnable) () -> {})).isTrue();

    verifyNoInteractions(currentUser, policy);
  }

  @Test
  void aRefusalFromThePolicyStopsTheRequest() throws Exception {
    when(currentUser.read(any())).thenReturn(Optional.of(member(ORG, false)));
    org.mockito.Mockito.doThrow(new IllegalStateException("refused"))
      .when(policy)
      .require(ORG, OrgAccess.READ);

    org.assertj.core.api.Assertions.assertThatThrownBy(() ->
      run("GET", handler(new Plain(), "read"))
    ).isInstanceOf(IllegalStateException.class);
  }
}
