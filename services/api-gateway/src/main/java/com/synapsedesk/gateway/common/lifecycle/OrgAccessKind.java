package com.synapsedesk.gateway.common.lifecycle;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Declares a route's {@link OrgAccess} category, on a method or a whole controller
 * (the method wins).
 *
 * <p>A route with no declaration is still gated, as a READ or a WRITE by its verb:
 * the stricter guess is the safe default, where an allowlist of gated paths would
 * fail the other way and leave a forgotten route open.
 *
 * <p><b>{@code AUTH} also stands for "this route is never authenticated".</b> There
 * is no separate authentication layer the gate could follow, so the public routes
 * (health, version, the two webhook intakes) carry {@code AUTH} to be exempt.
 * {@code test/fixtures/lifecycle/org-access-routes.json} holds every route's
 * effective category, and {@code OrgAccessRoutesTest} checks it.
 */
@Documented
@Retention(RetentionPolicy.RUNTIME)
@Target({ ElementType.METHOD, ElementType.TYPE })
public @interface OrgAccessKind {
  OrgAccess value();
}
