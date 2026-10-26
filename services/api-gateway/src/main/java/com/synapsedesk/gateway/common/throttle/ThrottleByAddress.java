package com.synapsedesk.gateway.common.throttle;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Keys the route's limit on the caller's address alone, signed in or not:
 * `ip:<ip>`, never `user:<sub>`. For a route whose callers are often signed
 * out, like `POST /client-errors`.
 */
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface ThrottleByAddress {}
