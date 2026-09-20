package com.synapsedesk.gateway.config;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The environment these tests boot with: {@code apps/api-gateway/.env.example},
 * read from where it lives.
 *
 * <p><b>The shared file, never a copy.</b> Both gateways read one environment,
 * so a fixture listing its own 46 values would be a second source of truth
 * that drifts silently — and the drift would surface at a switch, on whichever
 * implementation was standing by. Booting from the documented example also
 * makes these rows say something stronger than "binding works": they say the
 * example a developer is handed actually starts this gateway.
 *
 * <p>Only ACTIVE lines are returned. A commented key is a documented DEFAULT
 * (`# SWAGGER_ENABLED = false`), and supplying it here would mean the default
 * path was never exercised.
 */
public final class SharedEnvironment {

  /** From `apps/api-gateway-java/`, where Maven runs, to the shared file. */
  public static final Path ENV_EXAMPLE = Path.of("../api-gateway/.env.example");

  private static final Pattern ACTIVE =
      Pattern.compile("^\\s*([A-Z][A-Z0-9_]*)\\s*=\\s*(.*?)\\s*$");

  private SharedEnvironment() {}

  /** Every active `KEY = value` pair, in file order. */
  public static Map<String, String> values() {
    Map<String, String> values = new LinkedHashMap<>();

    for (String line : lines()) {
      Matcher matcher = ACTIVE.matcher(line);
      if (matcher.matches()) {
        values.put(matcher.group(1), unquote(matcher.group(2)));
      }
    }

    return values;
  }

  /** Every key the file DOCUMENTS, commented defaults included. */
  public static java.util.Set<String> documentedKeys() {
    java.util.Set<String> keys = new java.util.LinkedHashSet<>();

    for (String line : lines()) {
      Matcher matcher = ACTIVE.matcher(line.replaceFirst("^\\s*#\\s*", ""));
      if (matcher.matches()) {
        keys.add(matcher.group(1));
      }
    }

    return keys;
  }

  /**
   * Strips the outer quotes the file uses where a value contains spaces.
   *
   * <p>`EMAIL_SENDER` is the one: `'"SynapseDesk" &lt;noreply@example.com&gt;'`.
   * The INNER quotes are part of the address and stay.
   */
  private static String unquote(String value) {
    if (value.length() >= 2
        && ((value.startsWith("'") && value.endsWith("'"))
            || (value.startsWith("\"") && value.endsWith("\"")))) {
      return value.substring(1, value.length() - 1);
    }

    return value;
  }

  private static java.util.List<String> lines() {
    try {
      return Files.readAllLines(ENV_EXAMPLE);
    } catch (IOException cause) {
      throw new IllegalStateException("cannot read " + ENV_EXAMPLE.toAbsolutePath(), cause);
    }
  }
}
