package com.synapsedesk.gateway.common.error;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

/**
 * An error's `details`, carried across gRPC behind a marker in its message:
 * `[details:<base64url JSON>] text`, after any `[http:NNN]` marker. The same
 * carrier `@synapsedesk/core`'s `withErrorDetails` writes.
 *
 * <p>A marker whose payload is not a JSON object is left as text, rather
 * than half-read.
 */
public final class ErrorDetails {

  private ErrorDetails() {}

  private static final Pattern MARKER = Pattern.compile(
    "^\\[details:([A-Za-z0-9_-]+)]\\s*"
  );

  private static final JsonMapper JSON = JsonMapper.builder().build();

  /**
   * A message split into its details and its text.
   *
   * @param details the object, or null when the message carried none
   * @param message the text a client sees
   */
  public record Lifted(@Nullable Map<String, Object> details, String message) {}

  /** Lifts a leading details marker out of a message. */
  public static Lifted lift(String message) {
    Matcher matcher = MARKER.matcher(message);
    if (!matcher.find()) {
      return new Lifted(null, message);
    }

    try {
      byte[] decoded = Base64.getUrlDecoder().decode(matcher.group(1));
      Object parsed = JSON.readValue(
        new String(decoded, StandardCharsets.UTF_8),
        Object.class
      );
      if (!(parsed instanceof Map<?, ?>)) {
        return new Lifted(null, message);
      }
      Map<String, Object> details = JSON.convertValue(
        parsed,
        new TypeReference<Map<String, Object>>() {}
      );
      return new Lifted(details, message.substring(matcher.end()));
    } catch (RuntimeException unreadable) {
      return new Lifted(null, message);
    }
  }
}
