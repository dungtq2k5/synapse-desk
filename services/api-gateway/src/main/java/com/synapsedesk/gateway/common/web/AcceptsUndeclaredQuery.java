package com.synapsedesk.gateway.common.web;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Exempts a route from {@link UndeclaredQueryInterceptor}: a query name the
 * handler does not declare is ignored rather than refused.
 *
 * <p>For a route whose published contract binds its query parameters one by
 * one ({@code GET /billing/invoices} reads {@code limit} alone), where an
 * extra name has always been accepted. Each use says why.
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface AcceptsUndeclaredQuery {}
