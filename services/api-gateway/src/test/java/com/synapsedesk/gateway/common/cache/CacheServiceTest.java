package com.synapsedesk.gateway.common.cache;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.Cursor;
import org.springframework.data.redis.core.ScanOptions;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/**
 * The generations' failure paths, which a live Redis can't be made to take:
 * unreadable generations mean no cache at all (never a stale answer), a
 * failed increment still deletes, and a key outside the scoped namespace is
 * cached as it was.
 */
class CacheServiceTest {

  private StringRedisTemplate redis;
  private ValueOperations<String, String> values;
  private CacheService cache;

  @SuppressWarnings("unchecked")
  @BeforeEach
  void setUp() {
    redis = mock(StringRedisTemplate.class);
    values = mock(ValueOperations.class);
    when(redis.opsForValue()).thenReturn(values);
    cache = new CacheService(redis, new ObjectMapper());
  }

  @Test
  void unreadableGenerationsMeanNoCacheNotAStaleAnswer() {
    when(values.multiGet(anyList())).thenThrow(
      new IllegalStateException("redis is down")
    );
    String key = cache.buildKey("org-1", "documents", Map.of());

    assertThat(cache.wrap(key, 30, String.class, () -> "fresh")).isEqualTo(
      "fresh"
    );
    assertThat(
      cache.wrapTyped(key, 30, new TypeReference<String>() {}, () -> "fresh")
    ).isEqualTo("fresh");

    verify(values, never()).get(anyString());
    verify(values, never()).set(
      anyString(),
      anyString(),
      any(java.time.Duration.class)
    );
  }

  @Test
  void aKeyOutsideTheScopedNamespaceIsCachedAsItWas() {
    cache.wrap("cache-test:1", 30, String.class, () -> "value");
    cache.wrap("cache:no-scope", 30, String.class, () -> "value");

    verify(values).get("cache-test:1");
    verify(values).get("cache:no-scope");
    verify(values, never()).multiGet(anyList());
  }

  @SuppressWarnings("unchecked")
  @Test
  void aFailedIncrementStillDeletesTheScope() {
    when(values.increment(anyString())).thenThrow(
      new IllegalStateException("redis is down")
    );
    Cursor<String> none = mock(Cursor.class);
    when(redis.scan(any(ScanOptions.class))).thenReturn(none);

    assertThat(cache.invalidateScope("org-1", "documents")).isZero();
    verify(redis).scan(any(ScanOptions.class));
  }
}
