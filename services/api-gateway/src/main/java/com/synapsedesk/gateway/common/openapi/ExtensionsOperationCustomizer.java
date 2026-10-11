package com.synapsedesk.gateway.common.openapi;

import io.swagger.v3.oas.models.Operation;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import org.springdoc.core.customizers.OperationCustomizer;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;

/**
 * Publishes the {@code x-cache} and {@code x-webhook} extensions from the annotations
 * that sit on the handlers, which take their values from the constants the cache call
 * and the intake use. Both are claims about behaviour, so they are derived, never
 * copied: the scope, TTL and key of each cached read, and the signature header,
 * idempotency key and caller of the intake, were checked against the code first.
 */
@Component
@Order(OpenApiCustomizerOrder.EXTENSIONS)
public class ExtensionsOperationCustomizer implements OperationCustomizer {

  @Override
  public Operation customize(Operation operation, HandlerMethod handler) {
    CachedRead cached = handler.getMethodAnnotation(CachedRead.class);
    if (cached != null) {
      Map<String, Object> value = new LinkedHashMap<>();
      value.put("scope", cached.scope());
      value.put("ttlSeconds", cached.ttlSeconds());
      value.put("varyBy", cached.varyBy().name().toLowerCase(Locale.ROOT));
      operation.addExtension("x-cache", value);
    }
    WebhookIntake intake = handler.getMethodAnnotation(WebhookIntake.class);
    if (intake != null) {
      Map<String, Object> value = new LinkedHashMap<>();
      value.put("signatureHeader", intake.signatureHeader());
      value.put("idempotencyKey", intake.idempotencyKey());
      value.put("caller", intake.caller());
      operation.addExtension("x-webhook", value);
    }

    return operation;
  }
}
