package com.synapsedesk.gateway.common.security;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Every route of the annotated controller is for a super admin only (the
 * {@code /platform} surface). {@link SessionInterceptor} enforces it right after it has
 * confirmed a session, so a tenant member is refused with 403 BEFORE the body is bound
 * or validated.
 *
 * <p>The handlers still call {@code SuperAdminCheck} themselves. That is not a second
 * copy of the rule so much as the second door: a service called any other way (the
 * GraphQL schema, a test) is still guarded.
 */
@Documented
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
public @interface SuperAdminOnly {}
