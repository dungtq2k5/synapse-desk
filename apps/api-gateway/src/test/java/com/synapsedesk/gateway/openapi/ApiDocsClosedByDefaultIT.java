package com.synapsedesk.gateway.openapi;

import static org.assertj.core.api.Assertions.assertThat;

import com.synapsedesk.gateway.HttpProbe;
import com.synapsedesk.gateway.config.SharedEnvironmentInitializer;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ContextConfiguration;

/**
 * `/v3/api-docs` is not served when `SWAGGER_ENABLED` is unset — the state
 * `.env.example` documents, where the key is commented out.
 *
 * <p>Through a real boot and a real request: the setting is only worth
 * something if the endpoint actually closes, and a test that read the bound
 * property back would pass with the endpoint wide open.
 *
 * <p><b>Closes its context when it finishes</b>, for the reason
 * {@link ErrorEnvelopeOperationCustomizerIT} gives.
 */
@SpringBootTest(
  webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
  properties = "management.server.port=0"
)
@ContextConfiguration(initializers = SharedEnvironmentInitializer.class)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class ApiDocsClosedByDefaultIT {

  @Value("${local.server.port}")
  private int port;

  @Test
  void theDocumentIsNotServedWhenTheFlagIsUnset() {
    assertThat(HttpProbe.get(port, "/v3/api-docs").status()).isEqualTo(404);
  }
}
