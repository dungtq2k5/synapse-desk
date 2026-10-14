package com.synapsedesk.gateway.common.openapi;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * The explicit set of 4xx error responses a route can produce, published in
 * the route's OpenAPI operation.
 *
 * <p><b>Only the explicit codes live here.</b> {@code 500} (always), {@code
 * 429} (unless {@link #throttled} is {@code false}), and {@code 415} (iff
 * the method has a {@code @RequestBody} parameter) are added by {@link
 * ErrorEnvelopeOperationCustomizer} — derived, never declared, because 415
 * already has a source of truth ({@code @RequestBody}'s presence), so
 * declaring it here too would be the same fact in two places, and the one that drifts is the
 * one nobody reads.
 *
 * <p>{@link #throttled} defaults to {@code true} — the global throttle
 * interceptor reaches every route in this gateway ({@code WebMvcConfig}
 * registers it unconditionally). Only pass {@code throttled = false} where
 * the route has an actual, matching runtime exemption — setting the value here
 * without the exemption existing would make the document describe behavior
 * the code does not have, the exact class of bug the customizer exists to
 * avoid, not reproduce.
 *
 * <p>Allowed values: {@code "400"}, {@code "401"}, {@code "402"}, {@code "403"},
 * {@code "404"}, {@code "409"}, {@code "422"}, {@code "503"}. {@code "429"},
 * {@code "500"}, and {@code "415"} are deliberately not valid values here,
 * because a value that does nothing is worse than one that does not exist.
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface ApiErrors {
  String[] value() default {};

  boolean throttled() default true;

  /**
   * A status's description for this route, where the shared one would
   * mislead: a {@code 403} that means a wrong password rather than a missing
   * permission.
   */
  Description[] descriptions() default {};

  /** One status's description, overriding the shared one on this route. */
  @Target({})
  @Retention(RetentionPolicy.RUNTIME)
  @interface Description {
    String status();

    String value();
  }

  /**
   * A {@code 403} that means the password or code a signed-in caller
   * re-entered is wrong, not a missing permission.
   */
  String WRONG_PASSWORD_OR_CODE = "The password or code is wrong.";
}
