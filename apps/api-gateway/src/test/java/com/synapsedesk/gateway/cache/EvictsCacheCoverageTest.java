package com.synapsedesk.gateway.cache;

import static org.assertj.core.api.Assertions.assertThat;

import com.synapsedesk.gateway.openapi.CachedRead;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.type.filter.AnnotationTypeFilter;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Every write handler in a controller that caches a read evicts what it
 * caches: {@code @EvictsCache} names each scope the class's {@link
 * CachedRead}s declare.
 *
 * <p>Scanned from the controllers, never from a list of routes: a new write
 * added beside a cached read is held without anyone remembering to add it,
 * and a new cached read puts every write in its class under the rule.
 *
 * <p>What this cannot see is a write in ANOTHER class that changes the same
 * answer (a user's roles, counted by the roles list). Those carry the
 * annotation by hand, and the contract suite's write-then-read rows hold
 * their effect.
 */
class EvictsCacheCoverageTest {

  @Test
  void everyWriteBesideACachedReadEvictsItsScope() throws Exception {
    ClassPathScanningCandidateComponentProvider scanner =
      new ClassPathScanningCandidateComponentProvider(false);
    scanner.addIncludeFilter(new AnnotationTypeFilter(RestController.class));

    List<String> missing = new ArrayList<>();
    int cachedClasses = 0;
    int writes = 0;

    for (var candidate : scanner.findCandidateComponents(
      "com.synapsedesk.gateway"
    )) {
      Class<?> type = Class.forName(candidate.getBeanClassName());
      Set<String> scopes = new HashSet<>();
      for (Method method : type.getDeclaredMethods()) {
        CachedRead read = method.getAnnotation(CachedRead.class);
        if (read != null) scopes.add(read.scope());
      }
      if (scopes.isEmpty()) continue;
      cachedClasses += 1;

      for (Method method : type.getDeclaredMethods()) {
        if (!isWrite(method)) continue;
        writes += 1;
        EvictsCache evicts = method.getAnnotation(EvictsCache.class);
        Set<String> evicted =
          evicts == null
            ? Set.of()
            : new HashSet<>(Arrays.asList(evicts.value()));
        for (String scope : scopes) {
          if (!evicted.contains(scope)) {
            missing.add(
              "%s.%s does not evict '%s'".formatted(
                type.getSimpleName(),
                method.getName(),
                scope
              )
            );
          }
        }
      }
    }

    // Floors: a scan that found nothing would agree with everything.
    assertThat(cachedClasses).isGreaterThanOrEqualTo(3);
    assertThat(writes).isGreaterThanOrEqualTo(18);
    assertThat(missing).isEmpty();
  }

  private static boolean isWrite(Method method) {
    return (
      method.isAnnotationPresent(PostMapping.class) ||
      method.isAnnotationPresent(PutMapping.class) ||
      method.isAnnotationPresent(PatchMapping.class) ||
      method.isAnnotationPresent(DeleteMapping.class)
    );
  }
}
