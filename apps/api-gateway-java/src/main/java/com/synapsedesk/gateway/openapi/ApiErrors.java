package com.synapsedesk.gateway.openapi;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * The Java equivalent of Node's {@code @ApiFilterErrors} — the explicit set
 * of 4xx error responses a route can produce, ported one-to-one from the
 * Node controller carrying the same route.
 *
 * <p><b>Only the explicit codes live here.</b> {@code 500} (always), {@code
 * 429} (unless {@link #throttled} is {@code false}), and {@code 415} (iff
 * the method has a {@code @RequestBody} parameter) are added by {@link
 * ErrorEnvelopeOperationCustomizer} — the same "derived, never declared"
 * split Node's own decorator draws, and for the same reason: 415 already has
 * a source of truth ({@code @RequestBody}'s presence), so declaring it here
 * too would be the same fact in two places, and the one that drifts is the
 * one nobody reads.
 *
 * <p>{@link #throttled} defaults to {@code true} — the global throttle
 * interceptor reaches every route in this gateway ({@code WebMvcConfig}
 * registers it unconditionally). Only pass {@code throttled = false} where
 * Java has an actual, matching runtime exemption — mirroring the value here
 * without the exemption existing would make the document describe behavior
 * the code does not have, the exact class of bug the customizer exists to
 * avoid, not reproduce.
 *
 * <p>Allowed values: the same eight Node's own {@code ApiErrorStatus} type
 * allows — {@code "400"}, {@code "401"}, {@code "402"}, {@code "403"},
 * {@code "404"}, {@code "409"}, {@code "422"}, {@code "503"}. {@code "429"},
 * {@code "500"}, and {@code "415"} are deliberately not valid values here,
 * for the same reason Node's type excludes them: a value that does nothing
 * is worse than one that does not exist.
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface ApiErrors {
  String[] value() default {};

  boolean throttled() default true;
}
