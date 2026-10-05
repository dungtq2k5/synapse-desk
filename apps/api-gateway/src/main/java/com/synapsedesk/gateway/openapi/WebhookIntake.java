package com.synapsedesk.gateway.openapi;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * A signed webhook intake, published as the operation's {@code x-webhook} extension:
 * which header carries the signature, which payload field the delivery is made
 * idempotent on, and who calls it. Give it the intake's own constants.
 */
@Documented
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface WebhookIntake {
  String signatureHeader();

  String idempotencyKey();

  String caller();
}
