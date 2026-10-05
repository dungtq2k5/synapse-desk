package com.synapsedesk.gateway.openapi;

import static org.assertj.core.api.Assertions.assertThat;

import com.synapsedesk.gateway.HttpProbe;
import com.synapsedesk.gateway.config.SharedEnvironmentInitializer;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ContextConfiguration;

/**
 * Writes the document this gateway serves at {@code /v3/api-docs} to
 * {@code target/openapi-java.json}, which {@code npm run openapi:export} commits as
 * {@code docs/reference/openapi.json} and {@code npm run openapi:check} compares with it.
 *
 * <p>A test rather than a running process on purpose: a gateway booted by hand
 * holds its ports and collides with the suite's own boot, and a check that
 * reads a file a previous run left behind can detect an absent document but
 * never a stale one. Producing the file in the same command that consumes it
 * closes both.
 *
 * <p>It asserts only that a real document was written; the validation and the
 * comparison are {@code scripts/export-openapi.mjs}'s.
 *
 * <p><b>Closes its context when it finishes.</b> Spring caches a booted context
 * for the rest of the JVM, and this one holds the gateway lease with a live
 * cache-invalidation consumer on the shared broker — which silently evicts the
 * key {@code CacheInvalidationConsumerIT} asserts survives. Closing it runs the
 * lease's {@code @PreDestroy}, so nothing is left subscribed for the next class.
 */
@SpringBootTest(
  webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
  // The document is served only where `SWAGGER_ENABLED` turns it on.
  properties = { "management.server.port=0", "SWAGGER_ENABLED=true" }
)
@ContextConfiguration(initializers = SharedEnvironmentInitializer.class)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class OpenApiDocumentExportIT {

  static final Path OUTPUT = Path.of("target", "openapi-java.json");

  @Value("${local.server.port}")
  private int port;

  @Test
  void writesTheServedDocument() throws IOException {
    HttpProbe response = HttpProbe.get(port, "/v3/api-docs");

    assertThat(response.status()).isEqualTo(200);
    assertThat(response.json()).containsKey("paths");

    Files.createDirectories(OUTPUT.getParent());
    Files.writeString(OUTPUT, response.body(), StandardCharsets.UTF_8);
  }
}
