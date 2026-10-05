package com.synapsedesk.gateway.lifecycle;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Declares a route's {@link OrgAccess} category — Node's {@code @OrgAccessKind}, on a
 * method or a whole controller (the method wins).
 *
 * <p>A route with no declaration is still gated, as a READ or a WRITE by its verb:
 * the stricter guess is the safe default, where an allowlist of gated paths would
 * fail the other way and leave a forgotten route open.
 *
 * <p><b>{@code AUTH} also stands for "Node never authenticates this route".</b> Node
 * gates only where {@code JwtAuthGuard} ran, which Java has no layer for, so the
 * routes Node leaves public (health, version, the two webhook intakes) carry
 * {@code AUTH} to be exempt. {@code org-access-routes.json}, recomputed from Node's
 * controllers, holds every route's effective category equal in both gateways.
 */
@Documented
@Retention(RetentionPolicy.RUNTIME)
@Target({ ElementType.METHOD, ElementType.TYPE })
public @interface OrgAccessKind {
  OrgAccess value();
}
