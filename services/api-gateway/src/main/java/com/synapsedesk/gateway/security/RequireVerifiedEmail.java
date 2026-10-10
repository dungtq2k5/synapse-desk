package com.synapsedesk.gateway.security;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * The route needs a caller whose email address is verified, on the two routes that
 * send mail on the tenant's behalf (an unverified inviter could spray invitations from
 * an unproven address). A super admin has no verification flow to have completed, so
 * is exempt.
 *
 * <p>{@link SessionInterceptor} enforces it right after the session and BEFORE the
 * permission check (session, verified email, permission), so an unverified caller is
 * refused with 403 before the body is bound.
 */
@Documented
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface RequireVerifiedEmail {}
