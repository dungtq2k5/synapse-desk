package com.synapsedesk.gateway.security;

import com.synapsedesk.gateway.generated.model.CurrentUserResponseDto.PermissionCodesEnum;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Declares the permission(s) a route needs — `@RequirePermission`, reproduced.
 *
 * <p>Semantics are ANY, matching the Node decorator's own docblock:
 * {@code @RequirePermission(TICKET_ASSIGN, TICKET_ASSIGN_SELF)} needs either.
 * A route needing two distinct grants stacks the check twice, not this once
 * with two codes.
 *
 * <p><b>The value type is the generated registry, not a hand-typed one.</b>
 * {@link PermissionCodesEnum} comes from {@code CurrentUserResponseDto}'s
 * {@code permissionCodes} field, itself generated from Node's
 * {@code PERMISSION_CODES} (ADR 0038) via the OpenAPI document — so a code
 * that does not exist in the registry is a compile error here, never a typo
 * that silently never matches.
 *
 * <p>{@link PermissionInterceptor} is what reads this; the annotation alone
 * enforces nothing, same as the Node decorator alone does.
 */
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface RequirePermission {
  PermissionCodesEnum[] value();
}
