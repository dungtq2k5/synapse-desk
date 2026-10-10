package com.synapsedesk.gateway.openapi;

import static org.assertj.core.api.Assertions.assertThat;

import io.swagger.v3.oas.models.Operation;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.web.method.HandlerMethod;

/** The rule: the annotations on a handler become its extensions, value for value. */
class ExtensionsOperationCustomizerTest {

  private final ExtensionsOperationCustomizer customizer =
    new ExtensionsOperationCustomizer();

  static class Handlers {

    @CachedRead(
      scope = "things",
      ttlSeconds = 300,
      varyBy = CachedRead.VaryBy.CALLER
    )
    public void cached() {}

    @WebhookIntake(
      signatureHeader = "sig",
      idempotencyKey = "id",
      caller = "someone"
    )
    public void intake() {}

    public void plain() {}
  }

  private Operation publish(String name) throws Exception {
    return customizer.customize(
      new Operation(),
      new HandlerMethod(new Handlers(), Handlers.class.getMethod(name))
    );
  }

  @Test
  void aCachedReadPublishesItsScopeTtlAndKey() throws Exception {
    assertThat(publish("cached").getExtensions().get("x-cache")).isEqualTo(
      Map.of("scope", "things", "ttlSeconds", 300L, "varyBy", "caller")
    );
  }

  @Test
  void aWebhookIntakePublishesItsSignatureIdempotencyAndCaller()
    throws Exception {
    assertThat(publish("intake").getExtensions().get("x-webhook")).isEqualTo(
      Map.of(
        "signatureHeader",
        "sig",
        "idempotencyKey",
        "id",
        "caller",
        "someone"
      )
    );
  }

  @Test
  void aPlainHandlerPublishesNoExtension() throws Exception {
    assertThat(publish("plain").getExtensions()).isNull();
  }
}
