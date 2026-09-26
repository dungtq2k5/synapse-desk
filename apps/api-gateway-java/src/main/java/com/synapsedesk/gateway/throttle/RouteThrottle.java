package com.synapsedesk.gateway.throttle;

/**
 * {@code throttler.config.ts}'s tier names and {@code ROUTE_THROTTLE}
 * numbers, reproduced as annotation-usable constants — a Java annotation
 * argument must be a compile-time constant, so these cannot live in a
 * runtime-keyed map the way Node's object does.
 *
 * <p>Only the entries the Java gateway has routes for today are ported;
 * the rest (`aiDraft`, `chatMessage`, `export`, …) arrive with the modules
 * that carry them.
 */
public final class RouteThrottle {

  private RouteThrottle() {}

  /** The strict tier — {@code @AuthThrottle()} routes see this and nothing else. */
  public static final String AUTH_TIER = "authTier";

  /** Credential stuffing. */
  public static final long LOGIN_TTL_MS = 15 * 60_000;
  public static final int LOGIN_LIMIT = 5;

  public static final long REGISTER_TTL_MS = 15 * 60_000;
  public static final int REGISTER_LIMIT = 5;

  /** Mail bomb, and an account-enumeration probe if unlimited. */
  public static final long FORGOT_PASSWORD_TTL_MS = 60 * 60_000;
  public static final int FORGOT_PASSWORD_LIMIT = 3;

  /** An online password oracle for a caller who already holds a session. */
  public static final long CHANGE_PASSWORD_TTL_MS = 15 * 60_000;
  public static final int CHANGE_PASSWORD_LIMIT = 5;

  /** SMS pumping — costs real money per request. */
  public static final long OTP_REQUEST_TTL_MS = 10 * 60_000;
  public static final int OTP_REQUEST_LIMIT = 3;

  /** Second line behind `otps.max_attempts`. */
  public static final long OTP_VERIFY_TTL_MS = 10 * 60_000;
  public static final int OTP_VERIFY_LIMIT = 10;
}
