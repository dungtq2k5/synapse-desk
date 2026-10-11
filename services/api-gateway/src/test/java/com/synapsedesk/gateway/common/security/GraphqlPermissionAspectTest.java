package com.synapsedesk.gateway.common.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

import com.synapsedesk.gateway.common.auth.CurrentUser;
import com.synapsedesk.gateway.common.auth.RequestContext;
import com.synapsedesk.gateway.common.config.RuntimeProperties;
import com.synapsedesk.gateway.common.dto.CurrentUserResponseDto.PermissionCodesEnum;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.aop.AopAutoConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.junit.jupiter.SpringExtension;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * The wiring itself — a real Spring context, a real CGLIB proxy, no
 * `HandlerInterceptor` involved. {@link PermissionInterceptorTest} covers
 * the enforcement rules ({@link PermissionChecker}'s own logic); this covers
 * the one thing that test cannot: that the advice actually intercepts a
 * `*Resolver` bean's `@RequirePermission` method and leaves a same-shaped
 * non-resolver bean alone.
 *
 * <p>
 * Plain {@code SpringExtension}, not {@code @SpringBootTest} — the latter
 * auto-detects {@code GatewayApplication} as the nearest
 * {@code @SpringBootConfiguration} and merges it in regardless of {@code
 * classes}, pulling in Redis/gRPC autoconfiguration this test has no env
 * for. Only {@link AopAutoConfiguration} is imported, since that is the one
 * piece of Boot machinery under test — everything else here is plain beans.
 */
@ExtendWith(SpringExtension.class)
@ContextConfiguration(classes = GraphqlPermissionAspectTest.Config.class)
class GraphqlPermissionAspectTest {

  @Autowired
  private FakeDepartmentsResolver resolver;

  @Autowired
  private FakeService plainService;

  @Autowired
  private CurrentUser currentUser;

  @BeforeEach
  void bindRequest() {
    RequestContextHolder.setRequestAttributes(
      new ServletRequestAttributes(new MockHttpServletRequest())
    );
  }

  @AfterEach
  void clearRequest() {
    RequestContextHolder.resetRequestAttributes();
  }

  @Test
  void aResolverMethodIsGuarded() {
    when(currentUser.require(Mockito.any())).thenReturn(
      context(false, List.of())
    );

    assertThatThrownBy(resolver::departments).hasMessageContaining(
      "Requires one of: department.read"
    );
  }

  @Test
  void theSameMethodOnAPlainServiceIsNotAdvised() {
    // Scoped to `*Resolver`, not every `@RequirePermission` method — the
    // annotation alone proves nothing; this proves the pointcut's scope.
    assertThat(plainService.departments()).isEqualTo("not intercepted");
  }

  @Test
  void aGrantedCallerProceeds() {
    when(currentUser.require(Mockito.any())).thenReturn(
      context(false, List.of("department.read"))
    );

    assertThat(resolver.departments()).isEqualTo("ok");
  }

  private RequestContext context(
    boolean superAdmin,
    List<String> permissionCodes
  ) {
    return new RequestContext(
      "22222222-2222-4222-8222-222222222222",
      "11111111-1111-4111-8111-111111111111",
      superAdmin,
      List.of(),
      permissionCodes,
      true,
      "127.0.0.1",
      "test-agent"
    );
  }

  /** Named `*Resolver`, the pointcut's own test. */
  static class FakeDepartmentsResolver {

    @RequirePermission(PermissionCodesEnum.DEPARTMENT_READ)
    String departments() {
      return "ok";
    }
  }

  /** Same annotation, same method body, NOT named `*Resolver`. */
  static class FakeService {

    @RequirePermission(PermissionCodesEnum.DEPARTMENT_READ)
    String departments() {
      return "not intercepted";
    }
  }

  // A plain `@Configuration`, not `@TestConfiguration` — the latter is
  // ADDED alongside whatever `@SpringBootConfiguration` the test bootstrap
  // auto-detects (here, `GatewayApplication`, which then demands the whole
  // app's environment). This class IS the root config `@SpringBootTest`'s
  // `classes` attribute points at, so nothing else gets pulled in.
  @Configuration
  @Import({
    AopAutoConfiguration.class,
    GraphqlPermissionAspect.class,
    PermissionChecker.class,
  })
  static class Config {

    @Bean
    FakeDepartmentsResolver fakeDepartmentsResolver() {
      return new FakeDepartmentsResolver();
    }

    @Bean
    FakeService fakeService() {
      return new FakeService();
    }

    @Bean
    CurrentUser currentUser() {
      return Mockito.mock(CurrentUser.class);
    }

    @Bean
    RuntimeProperties runtimeProperties() {
      return new RuntimeProperties(
        "development",
        0,
        "/api",
        false,
        "1.0.0",
        "sha",
        "time"
      );
    }
  }
}
