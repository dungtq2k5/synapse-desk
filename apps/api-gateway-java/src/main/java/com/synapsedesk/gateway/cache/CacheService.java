package com.synapsedesk.gateway.cache;

import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import java.util.function.Supplier;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import tools.jackson.databind.DeserializationContext;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.SerializationContext;
import tools.jackson.databind.deser.std.StdDeserializer;
import tools.jackson.databind.module.SimpleModule;
import tools.jackson.databind.ser.std.StdSerializer;

/**
 * The shared cache — `cache.service.ts`, reproduced key-for-key and
 * byte-for-byte.
 *
 * <p><b>Both halves are the risk plan 83 §1b names.</b> The KEY format
 * (`cache:{org}|{scope}|{params}`) is easy to get right by eye; the VALUE
 * encoding is not — plain JSON writes an {@link OffsetDateTime} as a bare ISO
 * string, and `GraphQLISODateTime.serialize()` on the Node side reads a bare
 * string as {@code null} rather than throwing. So a Java-written entry with an
 * untagged timestamp reads as "never computed" on every Node hit, silently. A
 * {@link SimpleModule} here writes the SAME `{"__cache_date__": "…"}` shape
 * `encode()` does, which is what makes the two implementations' entries
 * interchangeable rather than merely similarly-shaped.
 *
 * <p>A Super Admin's tenant segment is the literal `no-tenant`, matching
 * `NO_TENANT` — never an empty segment, which would collide every tenantless
 * read under `cache:|…`.
 */
@Service
public class CacheService {

  /** The tag a timestamp is stored under — matches `DATE_TAG` exactly. */
  static final String DATE_TAG = "__cache_date__";

  /**
   * `Date.prototype.toISOString()`, exactly: always 3 fractional digits, always
   * `Z`. {@link java.time.Instant#toString()} drops trailing zero millis and
   * cannot be used here — the wire bytes must match Node's, not merely parse.
   */
  private static final DateTimeFormatter JS_ISO =
      DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(java.time.ZoneOffset.UTC);

  private static final String PREFIX = "cache:";
  private static final String NO_TENANT = "no-tenant";

  private final StringRedisTemplate redis;
  private final ObjectMapper json;

  public CacheService(StringRedisTemplate redis, ObjectMapper json) {
    this.redis = redis;

    SimpleModule dates = new SimpleModule();
    dates.addSerializer(OffsetDateTime.class, new TaggedDateSerializer());
    dates.addDeserializer(OffsetDateTime.class, new TaggedDateDeserializer());
    this.json = json.rebuild().addModule(dates).build();
  }

  /**
   * The key. Parameters are SORTED (a {@link TreeMap}) for the reason
   * `buildKey` states: two spellings of the same question must be one entry,
   * not two.
   */
  public String buildKey(String organizationId, String scope, Map<String, String> params) {
    Map<String, String> sorted = new TreeMap<>(params == null ? Map.of() : params);
    sorted.values().removeIf(v -> v == null || v.isEmpty());

    StringBuilder joined = new StringBuilder();
    boolean first = true;
    for (var entry : sorted.entrySet()) {
      if (!first) {
        joined.append('&');
      }
      joined.append(entry.getKey()).append('=').append(entry.getValue());
      first = false;
    }

    String tenant = (organizationId == null || organizationId.isEmpty()) ? NO_TENANT : organizationId;

    return PREFIX + tenant + "|" + scope + "|" + joined;
  }

  /** Read-through, the only read path — `wrap()`, reproduced. Fails OPEN on any Redis error. */
  public <T> T wrap(String key, long ttlSeconds, Class<T> type, Supplier<T> produce) {
    try {
      String cached = redis.opsForValue().get(key);
      if (cached != null) {
        return json.readValue(cached, type);
      }
    } catch (RuntimeException cacheReadFailed) {
      // Fails open: a cache outage makes the product slow, never down.
    }

    T value = produce.get();

    try {
      redis.opsForValue().set(key, json.writeValueAsString(value), java.time.Duration.ofSeconds(ttlSeconds));
    } catch (RuntimeException cacheWriteFailed) {
      // Same fail-open rule on the write side.
    }

    return value;
  }

  /** For a probe that needs the exact bytes rather than a decoded value. */
  public Optional<String> raw(String key) {
    return Optional.ofNullable(redis.opsForValue().get(key));
  }

  /** For a probe writing Node's exact wire format directly, to prove Java reads it. */
  public void putRaw(String key, String value, long ttlSeconds) {
    redis.opsForValue().set(key, value, java.time.Duration.ofSeconds(ttlSeconds));
  }

  private static final class TaggedDateSerializer extends StdSerializer<OffsetDateTime> {
    TaggedDateSerializer() {
      super(OffsetDateTime.class);
    }

    @Override
    public void serialize(OffsetDateTime value, tools.jackson.core.JsonGenerator gen, SerializationContext ctx) {
      gen.writeStartObject();
      gen.writeStringProperty(DATE_TAG, JS_ISO.format(value.toInstant()));
      gen.writeEndObject();
    }
  }

  private static final class TaggedDateDeserializer extends StdDeserializer<OffsetDateTime> {
    TaggedDateDeserializer() {
      super(OffsetDateTime.class);
    }

    @Override
    public OffsetDateTime deserialize(tools.jackson.core.JsonParser p, DeserializationContext ctx) {
      JsonNode node = ctx.readTree(p);
      String iso = node.path(DATE_TAG).asString();

      return OffsetDateTime.parse(iso);
    }
  }
}
