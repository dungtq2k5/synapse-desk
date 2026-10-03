package com.synapsedesk.gateway.openapi;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Says which credential a route is published as requiring, for the routes that
 * are NOT the default. A handler without this annotation is published as secured
 * by the session cookie ({@code access-cookie}); see
 * {@link SecurityOpenApiCustomizer}.
 *
 * <p>Example: {@code @RouteSecurity(RouteSecurity.Scheme.NONE)} on a sign-in
 * handler publishes {@code security: []}, meaning "no credential needed".
 */
@Documented
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface RouteSecurity {
  Scheme value();

  /** The credential a route is published as requiring. */
  enum Scheme {
    /** Public: {@code security: []}. */
    NONE,
    /** The refresh-token cookie, for the token-refresh route only. */
    REFRESH_COOKIE,
    /** The second-factor challenge cookie, for the 2FA-authenticate route only. */
    MFA_COOKIE,
    /**
     * A full session OR a live login challenge, checked by the handler itself (the
     * two 2FA enrolment routes, which a member holding only a challenge must reach).
     * Published as the session cookie, as the committed document does, and not
     * gated ahead of the body: the handler decides which credential it was given.
     */
    SESSION_OR_CHALLENGE,
  }
}
