package com.synapsedesk.gateway.common.throttle;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.synapsedesk.gateway.common.auth.CurrentUser;
import com.synapsedesk.gateway.common.config.ThrottleProperties;
import com.synapsedesk.gateway.common.web.CachedBodyRequest;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Optional;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.http.HttpStatus;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/**
 * `ThrottlerInterceptor`, against a stand-in controller — the enforcement
 * logic, not the wiring. {@link ThrottlerWiringTest} covers the wiring: the
 * same class this file exercises directly, reached instead through
 * {@link com.synapsedesk.gateway.common.security.WebMvcConfig} and a real request,
 * which is the only way to catch the bean existing, injecting, and never
 * running — the exact failure mode this pair closes.
 */
class ThrottlerInterceptorTest {

  private final StringRedisTemplate redis = mock(StringRedisTemplate.class);
  private final ValueOperations<String, String> valueOps = mock();
  private final CurrentUser currentUser = mock(CurrentUser.class);
  private final HttpServletRequest request = mock(HttpServletRequest.class);
  private final HttpServletResponse response = mock(HttpServletResponse.class);
  private final ObjectMapper json = new ObjectMapper();

  private final ThrottleProperties properties = new ThrottleProperties(
    1_000L,
    30,
    10_000L,
    150,
    60_000L,
    600,
    900_000L,
    5,
    30,
    60_000L
  );

  private final ThrottlerInterceptor interceptor = new ThrottlerInterceptor(
    redis,
    properties,
    currentUser,
    json
  );

  @AuthThrottle
  private void authRoute() {}

  @SuppressWarnings("unused") // looked up by name: handlerFor("generalRoute")
  private void generalRoute() {}

  @SkipThrottle
  private void skippedRoute() {}

  @Test
  void aSkipThrottleRouteEvaluatesNoTierAndWritesNoCounter()
    throws NoSuchMethodException {
    boolean proceeds = interceptor.preHandle(
      request,
      response,
      handlerFor("skippedRoute")
    );

    assertThat(proceeds).isTrue();
    verifyNoInteractions(redis);
  }

  @Test
  void aGeneralRouteEvaluatesTheThreeGeneralTiersAndNeverAuthTier()
    throws NoSuchMethodException {
    when(redis.opsForValue()).thenReturn(valueOps);
    when(valueOps.increment(anyString())).thenReturn(1L);
    when(currentUser.verifiedSubject(request)).thenReturn(Optional.empty());
    when(request.getHeader("X-Forwarded-For")).thenReturn(null);
    when(request.getRemoteAddr()).thenReturn("203.0.113.9");

    interceptor.preHandle(request, response, handlerFor("generalRoute"));

    verify(valueOps).increment(argThatContains(":short:"));
    verify(valueOps).increment(argThatContains(":medium:"));
    verify(valueOps).increment(argThatContains(":long:"));
    verify(valueOps, never()).increment(argThatContains(":authTier:"));
  }

  @Test
  void anAuthThrottleRouteEvaluatesOnlyAuthTier() throws NoSuchMethodException {
    when(redis.opsForValue()).thenReturn(valueOps);
    when(valueOps.increment(anyString())).thenReturn(1L);
    when(currentUser.verifiedSubject(request)).thenReturn(Optional.empty());
    when(request.getHeader("X-Forwarded-For")).thenReturn(null);
    when(request.getRemoteAddr()).thenReturn("203.0.113.9");

    interceptor.preHandle(request, response, handlerFor("authRoute"));

    verify(valueOps).increment(argThatContains(":authTier:"));
    verify(valueOps, never()).increment(argThatContains(":short:"));
    verify(valueOps, never()).increment(argThatContains(":medium:"));
    verify(valueOps, never()).increment(argThatContains(":long:"));
  }

  @Test
  void aRedisFailureFailsOpenRatherThanThrowing() throws NoSuchMethodException {
    when(redis.opsForValue()).thenReturn(valueOps);
    when(valueOps.increment(anyString())).thenThrow(
      new org.springframework.data.redis.RedisConnectionFailureException("down")
    );
    when(currentUser.verifiedSubject(request)).thenReturn(Optional.empty());
    when(request.getHeader("X-Forwarded-For")).thenReturn(null);
    when(request.getRemoteAddr()).thenReturn("203.0.113.9");

    // Three general tiers, each hitting the same failure: none may propagate,
    // and the request must still be allowed through.
    boolean allowed = interceptor.preHandle(
      request,
      response,
      handlerFor("generalRoute")
    );

    assertThat(allowed).isTrue();
  }

  @Test
  void theTrackerKeysAVerifiedCallerBySubjectNotIp()
    throws NoSuchMethodException {
    when(redis.opsForValue()).thenReturn(valueOps);
    when(valueOps.increment(anyString())).thenReturn(1L);
    // A 2FA-PENDING token still verifies — `CurrentUser#verifiedSubject`
    // deliberately skips the full-session filter `require()` applies, so a
    // half-authenticated caller is tracked as `user:<sub>` rather than
    // falling through to the IP bucket every other caller behind the same
    // NAT would share.
    when(currentUser.verifiedSubject(request)).thenReturn(
      Optional.of("user-42")
    );

    interceptor.preHandle(request, response, handlerFor("generalRoute"));

    verify(valueOps, atLeastOnce()).increment(argThatContains("user:user-42"));
    // Never asked for the IP — a verified caller's bucket does not depend on it.
    verify(request, never()).getRemoteAddr();
  }

  @Test
  void theTrackerFallsBackToIpWhenUnverifiedWithNoAccountHint()
    throws NoSuchMethodException {
    when(redis.opsForValue()).thenReturn(valueOps);
    when(valueOps.increment(anyString())).thenReturn(1L);
    when(currentUser.verifiedSubject(request)).thenReturn(Optional.empty());
    when(request.getHeader("X-Forwarded-For")).thenReturn(null);
    when(request.getRemoteAddr()).thenReturn("203.0.113.9");

    interceptor.preHandle(request, response, handlerFor("generalRoute"));

    verify(valueOps, atLeastOnce()).increment(
      argThatContains("ip:203.0.113.9")
    );
  }

  @Test
  void theTrackerTakesTheRightmostForwardedForHop()
    throws NoSuchMethodException {
    when(redis.opsForValue()).thenReturn(valueOps);
    when(valueOps.increment(anyString())).thenReturn(1L);
    when(currentUser.verifiedSubject(request)).thenReturn(Optional.empty());
    // The leftmost entry is client-supplied and spoofable; only the
    // rightmost is the one hop this deployment's own proxy appended.
    when(request.getHeader("X-Forwarded-For")).thenReturn(
      "198.51.100.7, 203.0.113.9"
    );

    interceptor.preHandle(request, response, handlerFor("generalRoute"));

    verify(valueOps, atLeastOnce()).increment(
      argThatContains("ip:203.0.113.9")
    );
    verify(valueOps, never()).increment(argThatContains("198.51.100.7"));
  }

  @Test
  void theTrackerReadsAnEmailFromACachedBodyForAnUnverifiedCaller()
    throws NoSuchMethodException {
    HttpServletRequest cached = mock(CachedBodyRequest.class);
    when(cached.getHeader("X-Forwarded-For")).thenReturn(null);
    when(cached.getRemoteAddr()).thenReturn("203.0.113.9");
    when(((CachedBodyRequest) cached).body()).thenReturn(
      "{\"email\":\"Rate@Example.com\"}".getBytes()
    );
    when(redis.opsForValue()).thenReturn(valueOps);
    when(valueOps.increment(anyString())).thenReturn(1L);
    when(currentUser.verifiedSubject(cached)).thenReturn(Optional.empty());

    interceptor.preHandle(cached, response, handlerFor("generalRoute"));

    // Lower-cased and trimmed, and combined with the IP — not a substitute
    // for it, since the address alone is still what a Redis outage or a
    // malformed body falls back to.
    verify(valueOps, atLeastOnce()).increment(
      argThatContains("ip:203.0.113.9|acct:rate@example.com")
    );
  }

  @Test
  void breachingTheShortTierLimitRefusesWithRetryAfterHeaders()
    throws NoSuchMethodException {
    when(redis.opsForValue()).thenReturn(valueOps);
    // `short`'s configured limit here is 30 (this test's own
    // `ThrottleProperties`); a count past it is what the interceptor
    // compares against on the FIRST general tier it evaluates, so the
    // exception fires before `medium`/`long` are ever reached.
    when(valueOps.increment(anyString())).thenReturn(31L);
    when(redis.getExpire(anyString(), eq(TimeUnit.MILLISECONDS))).thenReturn(
      60_000L
    );
    when(currentUser.verifiedSubject(request)).thenReturn(Optional.empty());
    when(request.getHeader("X-Forwarded-For")).thenReturn(null);
    when(request.getRemoteAddr()).thenReturn("203.0.113.9");

    assertThatThrownBy(() ->
      interceptor.preHandle(request, response, handlerFor("generalRoute"))
    )
      .asInstanceOf(
        org.assertj.core.api.InstanceOfAssertFactories.throwable(
          ResponseStatusException.class
        )
      )
      .extracting(ResponseStatusException::getStatusCode)
      .isEqualTo(HttpStatus.TOO_MANY_REQUESTS);

    verify(response).setHeader("Retry-After", "60");
    verify(response).setHeader("Retry-After-short", "60");
  }

  private HandlerMethod handlerFor(String methodName)
    throws NoSuchMethodException {
    return new HandlerMethod(this, getClass().getDeclaredMethod(methodName));
  }

  /** A key argument matcher, since the exact key embeds a controller/method name. */
  private static String argThatContains(String fragment) {
    return org.mockito.ArgumentMatchers.argThat(
      key -> key != null && key.contains(fragment)
    );
  }
}
