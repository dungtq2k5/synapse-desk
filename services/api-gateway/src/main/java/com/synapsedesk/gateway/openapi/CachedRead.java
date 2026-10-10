package com.synapsedesk.gateway.openapi;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * The read this handler serves from the response cache, published as the operation's
 * {@code x-cache} extension: {@code { scope, ttlSeconds, varyBy }}.
 *
 * <p>Give it the SAME constants the handler passes to {@code CacheService}, so the
 * published claim and the cache cannot say different things. Example:
 * {@code @CachedRead(scope = CACHE_SCOPE, ttlSeconds = LIST_CACHE_TTL_SECONDS,
 * varyBy = CachedRead.VaryBy.TENANT)}.
 */
@Documented
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface CachedRead {
  String scope();

  long ttlSeconds();

  VaryBy varyBy();

  /** What one cache entry is shared by. */
  enum VaryBy {
    /** Every caller in the tenant: the answer does not depend on who asks. */
    TENANT,
    /** Callers who can see the same things: the key carries a digest of what they see. */
    CALLER,
  }
}
