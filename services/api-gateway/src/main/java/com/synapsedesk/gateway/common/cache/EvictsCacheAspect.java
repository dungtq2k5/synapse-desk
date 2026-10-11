package com.synapsedesk.gateway.common.cache;

import com.synapsedesk.gateway.common.auth.CurrentRequest;
import com.synapsedesk.gateway.common.auth.CurrentUser;
import org.aspectj.lang.annotation.AfterReturning;
import org.aspectj.lang.annotation.Aspect;
import org.springframework.stereotype.Component;

/**
 * Runs {@link EvictsCache}: after the handler RETURNS, so a write that threw
 * evicts nothing, and before Spring writes the response, so a client that
 * reads again as soon as the write answers is not served the old entry.
 *
 * <p>{@link CacheService#invalidateScope} fails open, so an eviction that
 * cannot reach Redis costs stale entries until their TTL, never the response
 * to a write that already succeeded.
 */
@Aspect
@Component
public class EvictsCacheAspect {

  private final CacheService cache;
  private final CurrentUser currentUser;

  public EvictsCacheAspect(CacheService cache, CurrentUser currentUser) {
    this.cache = cache;
    this.currentUser = currentUser;
  }

  @AfterReturning("@annotation(evicts)")
  public void evict(EvictsCache evicts) {
    String organizationId = currentUser
      .require(CurrentRequest.request())
      .organizationId();
    for (String scope : evicts.value()) {
      cache.invalidateScope(organizationId, scope);
    }
  }
}
