package com.synapsedesk.gateway.security;

import com.synapsedesk.gateway.model.CurrentUserResponseDto.PermissionCodesEnum;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Declares the permission(s) a route needs.
 *
 * <p>Semantics are ANY:
 * {@code @RequirePermission(TICKET_ASSIGN, TICKET_ASSIGN_SELF)} needs either.
 * A route needing two distinct grants stacks the check twice, not this once
 * with two codes.
 *
 * <p><b>The value type is the generated registry, not a hand-typed one.</b>
 * {@link PermissionCodesEnum} comes from {@code CurrentUserResponseDto}'s
 * {@code permissionCodes} field, which holds the codes of {@code
 * PERMISSION_CODES} in `packages/contracts/src/configs/rbac.config.ts` (ADR 0038) —
 * so a code that does not exist in the registry is a compile error here,
 * never a typo that silently never matches.
 *
 * <p>{@link PermissionInterceptor} is what reads this; the annotation alone
 * enforces nothing.
 */
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface RequirePermission {
  PermissionCodesEnum[] value();
}
