package com.synapsedesk.gateway;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.SpringApplication;
import org.springframework.context.ConfigurableApplicationContext;

/**
 * A {@code .env} file in the working directory is NOT read.
 *
 * <p>J1, kept as a row rather than left in the plan. The claim is only worth
 * anything if the file actually exists while it is asserted — a null from a
 * missing file proves nothing — so this writes one, asserts it is there, and
 * removes it again.
 *
 * <p>What it protects: the decision that this module parses no {@code .env}
 * at all. Somebody adding a dotenv library to "make local runs easier" would
 * introduce a second configuration source that Kubernetes does not have, and
 * the first symptom would be a value that works locally and is absent in the
 * cluster.
 */
class DotEnvIsNotReadTest {

  private static final Path DOT_ENV = Path.of(".env");
  private static boolean written;

  @BeforeAll
  static void writeDotEnv() throws IOException {
    // Never clobber a developer's file: if one is here, the row has nothing
    // to write and the existing file serves just as well.
    written = !Files.exists(DOT_ENV);
    if (written) {
      Files.writeString(DOT_ENV, "DOTENV_ONLY=from-dot-env\n");
    }
  }

  @AfterAll
  static void removeDotEnv() throws IOException {
    if (written) {
      Files.deleteIfExists(DOT_ENV);
    }
  }

  @Test
  void springDoesNotReadDotEnvFiles() {
    assertThat(Files.exists(DOT_ENV)).isTrue();

    SpringApplication application = new SpringApplication(GatewayApplication.class);
    java.util.Map<String, Object> properties =
        new java.util.HashMap<>(com.synapsedesk.gateway.config.SharedEnvironment.values());
    properties.put("spring.main.web-application-type", "none");
    properties.put("management.server.port", "0");
    application.setDefaultProperties(properties);

    try (ConfigurableApplicationContext context = application.run()) {
      assertThat(context.getEnvironment().getProperty("DOTENV_ONLY")).isNull();
    }
  }
}
