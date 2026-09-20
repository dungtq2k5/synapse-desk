package com.synapsedesk.gateway.lease;

import java.time.Duration;

/**
 * The lease's shared vocabulary — the same keys, scripts and timings the Node
 * gateway uses.
 *
 * <p><b>These values are a CONTRACT between the two implementations, not a
 * setting.</b> Both read one Redis, and a Java pod with a different TTL or a
 * different key would not exclude the Node one — it would simply serve beside
 * it, which is the single outcome the lease exists to prevent. They are
 * written here rather than bound from configuration for that reason: there is
 * no deployment in which they should differ.
 *
 * <p>The scripts are byte-identical in behaviour to
 * `apps/api-gateway/src/common/lease/gateway-lease.service.ts`, and
 * `LeaseParityTest` asserts that by reading the TypeScript.
 */
public final class GatewayLease {

  private GatewayLease() {}

  /** Which implementation this process belongs to. Never configurable. */
  public static final String IMPLEMENTATION = "java";

  /** The other one. A standby waits for this set to empty. */
  public static final String OTHER = "node";

  /** How long an entry outlives its last refresh. */
  public static final Duration TTL = Duration.ofSeconds(30);

  /** How often a holder refreshes, comfortably inside {@link #TTL}. */
  public static final Duration REFRESH = Duration.ofSeconds(10);

  /**
   * How long a holder may go without a successful refresh before stepping
   * down — BEFORE the TTL, not at it.
   *
   * <p>At the TTL the other implementation may claim, so a holder that waited
   * for it would still be consuming when the new owner started. Two missed
   * refreshes is the deadline, and the gap to the TTL bounds any overlap.
   */
  public static final Duration FENCE = Duration.ofSeconds(20);

  /** Where one implementation's live pods are recorded. */
  public static String holdersKey(String implementation) {
    return "gateway:holders:" + implementation;
  }

  /**
   * Prunes expired entries of BOTH implementations, then adds the caller's
   * own only if the other implementation has no live pod left.
   *
   * <p>One script because the check and the claim have to be one step: two
   * standbys of different implementations running a read-then-write would
   * both see an empty set and both become active.
   *
   * <p>KEYS[1] mine, KEYS[2] theirs; ARGV[1] now, ARGV[2] expiry, ARGV[3] pod
   * id, ARGV[4] ttl.
   */
  public static final String CLAIM =
      """
      redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
      redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[1])
      if redis.call('ZCARD', KEYS[2]) > 0 then return 0 end
      redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
      redis.call('PEXPIRE', KEYS[1], ARGV[4])
      return 1
      """;

  /**
   * Extends the caller's OWN entry, and only if it is still there.
   *
   * <p>A plain `ZADD` would re-add an entry this process had already lost — to
   * a fence, or to a pause long enough for the TTL to expire — and two owners
   * is exactly what the lease prevents. Absent means lost.
   */
  public static final String REFRESH_SCRIPT =
      """
      if redis.call('ZSCORE', KEYS[1], ARGV[2]) == false then return 0 end
      redis.call('ZADD', KEYS[1], ARGV[1], ARGV[2])
      redis.call('PEXPIRE', KEYS[1], ARGV[3])
      return 1
      """;
}
