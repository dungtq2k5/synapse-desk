package com.synapsedesk.gateway.common.cache;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Evicts the caller's tenant's entries for each of {@link #value} once the handler
 * returns: the write has succeeded, and nothing has been sent yet.
 *
 * <p>On a handler that changes what a {@link
 * com.synapsedesk.gateway.common.openapi.CachedRead} route answers. Without it the
 * next read is served the answer from before the write until its TTL runs out.
 * Every write handler in a controller that declares a cached read must carry
 * it for that scope — {@code EvictsCacheCoverageTest} holds that — and a write
 * elsewhere that changes the same answer carries it too.
 *
 * <p>The tenant is the verified caller's, so the handler must require a
 * session. A route without one evicts in its own code.
 *
 * @see EvictsCacheAspect
 */
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface EvictsCache {
  /** The scopes, as their {@code CachedRead}s declare them. */
  String[] value();
}
