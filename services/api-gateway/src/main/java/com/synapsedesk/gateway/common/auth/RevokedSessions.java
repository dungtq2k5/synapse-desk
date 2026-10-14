package com.synapsedesk.gateway.common.auth;

import com.synapsedesk.gateway.common.contracts.SessionKeys;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/**
 * Whether a session family was revoked, so its still-unexpired access tokens
 * are refused now rather than when they lapse.
 *
 * <p>auth-service writes {@code revoked-session:{familyId}} on every revocation
 * (revoking a session, signing out, signing out everywhere, a password change
 * or reset, an admin's revoke), for as long as an access token lives; a token
 * names its family in {@code sid}. A token without one predates the claim and
 * is accepted until it expires.
 *
 * <p><b>Fails open.</b> A Redis that can't answer is logged and the token is
 * accepted, as every other Redis path here degrades rather than fails: the
 * token's own expiry (15 minutes) stays the backstop.
 */
@Component
public class RevokedSessions {

  private static final Logger LOG = LoggerFactory.getLogger(
    RevokedSessions.class
  );

  private final StringRedisTemplate redis;

  public RevokedSessions(StringRedisTemplate redis) {
    this.redis = redis;
  }

  /** Whether this family is revoked; {@code false} without one, or without Redis. */
  public boolean isRevoked(String sid) {
    if (sid == null) {
      return false;
    }
    try {
      return Boolean.TRUE.equals(
        redis.hasKey(SessionKeys.REVOKED_SESSION_KEY_PREFIX + sid)
      );
    } catch (RuntimeException failure) {
      LOG.warn(
        "Couldn't read whether session {} is revoked; accepting its token until it expires: {}",
        sid,
        failure.getMessage()
      );
      return false;
    }
  }

  /** The revoked ones among these families, in one read; none without Redis. */
  public Set<String> revokedAmong(Collection<String> sids) {
    List<String> ordered = new ArrayList<>(new HashSet<>(sids));
    if (ordered.isEmpty()) {
      return Set.of();
    }
    try {
      List<String> values = redis.opsForValue().multiGet(
        ordered
          .stream()
          .map(sid -> SessionKeys.REVOKED_SESSION_KEY_PREFIX + sid)
          .toList()
      );
      Set<String> revoked = new HashSet<>();
      for (int index = 0; values != null && index < values.size(); index++) {
        if (values.get(index) != null) {
          revoked.add(ordered.get(index));
        }
      }
      return revoked;
    } catch (RuntimeException failure) {
      LOG.warn(
        "Couldn't read which of {} socket session(s) are revoked; keeping them: {}",
        ordered.size(),
        failure.getMessage()
      );
      return Set.of();
    }
  }
}
