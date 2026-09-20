package com.synapsedesk.gateway.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.lang.reflect.RecordComponent;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Everything this gateway binds is a key the shared {@code .env.example}
 * publishes.
 *
 * <p>This is the coverage {@code SHARES_ENVIRONMENT_WITH} deliberately dropped
 * from `env-contract` and `manifest-contract` when the Java workspace stopped
 * being required to own an env file. Nothing else checks that what Java binds
 * and what the file documents agree.
 *
 * <p><b>The direction is from the CLASSES toward the file</b>, and that is the
 * whole design. A test that read the file and asserted "Java binds each of
 * these" would fail on every key the skeleton has not reached yet, and the
 * only way to keep it green would be a hand-maintained list — a registry
 * checked against itself, which is the shape that lets a guard pass while the
 * thing it guards is wrong.
 *
 * <p>The reverse — a key in the file that nothing here binds — is CORRECT
 * while this is a skeleton, and stays unchecked until the module steps are
 * done. It belongs on the cutover rehearsal's list, not in a test that ships
 * skipped.
 */
class EnvBindingContractTest {

  private static final List<Class<? extends Record>> PROPERTIES =
      List.of(
          RuntimeProperties.class,
          MetricsProperties.class,
          CorsProperties.class,
          StoreProperties.class,
          GrpcProperties.class,
          JwtProperties.class,
          CookieProperties.class,
          ThrottleProperties.class,
          InboundEmailProperties.class);

  private static final Path APPLICATION_YAML = Path.of("src/main/resources/application.yaml");

  /** `runtime.node-env` -> `NODE_ENV`, read from the yaml's placeholders. */
  private static final Pattern MAPPING =
      Pattern.compile("^(\\s*)([a-z0-9-]+):\\s*\\$\\{([A-Z][A-Z0-9_]*)(?::[^}]*)?}\\s*$");

  private static final Pattern GROUP = Pattern.compile("^([a-z0-9-]+):\\s*$");

  @Test
  void everyBoundFieldIsDocumentedInTheSharedEnvExample() throws IOException {
    Map<String, String> mappings = yamlMappings();
    var documented = SharedEnvironment.documentedKeys();
    List<String> findings = new ArrayList<>();

    for (Class<? extends Record> type : PROPERTIES) {
      String prefix = type.getAnnotation(ConfigurationProperties.class).prefix();

      for (RecordComponent component : type.getRecordComponents()) {
        String path = prefix + "." + kebab(component.getName());
        String key = mappings.get(path);

        if (key == null) {
          // A field with no mapping binds from nothing — it would be silently
          // null in production and is the first thing this catches.
          findings.add(type.getSimpleName() + "." + component.getName() + ": no ${ENV} in yaml");
        } else if (!documented.contains(key)) {
          findings.add(type.getSimpleName() + "." + component.getName() + " -> " + key
              + ": not in " + SharedEnvironment.ENV_EXAMPLE);
        }
      }
    }

    assertThat(findings).isEmpty();
  }

  @Test
  void theScanReachesEveryFieldRatherThanAnEmptyList() {
    // A reflection call that stopped returning components would report a
    // compliant tree. Nine classes and 46 fields today, which is also the Joi
    // schema's key count — the two implementations bind the same environment.
    int fields = PROPERTIES.stream().mapToInt(type -> type.getRecordComponents().length).sum();

    assertThat(PROPERTIES).hasSize(9);
    assertThat(fields).isEqualTo(46);
    // A FLOOR, not equality: a key the file publishes and Java does not yet
    // bind is correct while this is a skeleton, and equality here would turn
    // that into the reverse-direction check this suite deliberately omits.
    assertThat(SharedEnvironment.documentedKeys().size()).isGreaterThanOrEqualTo(fields);
  }

  /** Flat `group.property -> ENV_NAME` pairs from `application.yaml`. */
  private Map<String, String> yamlMappings() throws IOException {
    Map<String, String> mappings = new LinkedHashMap<>();
    String group = "";

    for (String line : Files.readAllLines(APPLICATION_YAML)) {
      Matcher top = GROUP.matcher(line);
      if (top.matches()) {
        group = top.group(1);
        continue;
      }

      Matcher mapping = MAPPING.matcher(line);
      if (mapping.matches() && !mapping.group(1).isEmpty()) {
        mappings.put(group + "." + mapping.group(2), mapping.group(3));
      }
    }

    return mappings;
  }

  private static String kebab(String camel) {
    return camel.replaceAll("([a-z0-9])([A-Z])", "$1-$2").toLowerCase();
  }
}
