package com.synapsedesk.gateway.common.throttle;

import static org.assertj.core.api.Assertions.assertThat;

import com.synapsedesk.gateway.common.openapi.ApiErrors;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.type.filter.AnnotationTypeFilter;
import org.springframework.stereotype.Controller;

/**
 * A route is exempt from throttling exactly when its published document says
 * so: {@link SkipThrottle} and {@code @ApiErrors(throttled = false)} together,
 * or neither.
 *
 * <p>Each half alone is a lie in one direction. {@code throttled = false}
 * without the exemption publishes "no 429" on a route that still answers one;
 * the exemption without it publishes a 429 the route can no longer answer.
 *
 * <p>Scanned from the controllers, so a route added with either half is held
 * without anyone listing it.
 */
class SkipThrottleDocumentedTest {

  @Test
  void everyExemptRouteIsDocumentedAsUnthrottledAndOnlyThose()
    throws Exception {
    ClassPathScanningCandidateComponentProvider scanner =
      new ClassPathScanningCandidateComponentProvider(false);
    // `@RestController` is meta-annotated with `@Controller`, so this finds both.
    scanner.addIncludeFilter(new AnnotationTypeFilter(Controller.class));

    List<String> mismatches = new ArrayList<>();
    int documented = 0;
    int exempt = 0;

    for (var candidate : scanner.findCandidateComponents(
      "com.synapsedesk.gateway"
    )) {
      Class<?> type = Class.forName(candidate.getBeanClassName());
      boolean classExempt = type.isAnnotationPresent(SkipThrottle.class);

      for (Method method : type.getDeclaredMethods()) {
        ApiErrors errors = method.getAnnotation(ApiErrors.class);
        if (errors == null) continue;

        documented += 1;
        boolean skips =
          classExempt || method.isAnnotationPresent(SkipThrottle.class);
        if (skips) exempt += 1;
        if (skips == errors.throttled()) {
          mismatches.add(
            "%s.%s: @SkipThrottle=%s, throttled=%s".formatted(
              type.getSimpleName(),
              method.getName(),
              skips,
              errors.throttled()
            )
          );
        }
      }
    }

    // Floors: a scan that found nothing would agree with everything.
    assertThat(documented).isGreaterThan(100);
    assertThat(exempt).isGreaterThanOrEqualTo(2);
    assertThat(mismatches).isEmpty();
  }
}
