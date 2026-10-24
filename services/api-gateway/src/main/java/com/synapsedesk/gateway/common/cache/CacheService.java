package com.synapsedesk.gateway.common.cache;

import com.synapsedesk.gateway.common.config.JsIsoFormat;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.Cursor;
import org.springframework.data.redis.core.ScanOptions;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.DeserializationContext;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.SerializationContext;
import tools.jackson.databind.deser.std.StdDeserializer;
import tools.jackson.databind.module.SimpleModule;
import tools.jackson.databind.ser.std.StdSerializer;

/**
 * The shared cache: Redis entries keyed `cache:{org}|{scope}|{params}`, with
 * JSON values.
 *
 * <p>
 * <b>Timestamps are tagged.</b> Plain JSON writes an {@link OffsetDateTime} as
 * a bare ISO string, which decodes back as a string, not a timestamp. A
 * {@link SimpleModule} here writes every timestamp as
 * `{"__cache_date__": "…"}` and reads that shape back into an
 * {@link OffsetDateTime}, so a cached value round-trips with its types.
 *
 * <p>
 * A Super Admin's tenant segment is the literal `no-tenant`, matching
 * `NO_TENANT` — never an empty segment, which would collide every tenantless
 * read under `cache:|…`.
 */
@Service
public class CacheService {

  private static final Logger LOG = LoggerFactory.getLogger(CacheService.class);

  /** The tag a timestamp is stored under. */
  static final String DATE_TAG = "__cache_date__";

  private static final String PREFIX = "cache:";
  private static final String NO_TENANT = "no-tenant";

  /**
   * Where the generation counters live, outside {@code cache:} so a scope's
   * {@code SCAN} never deletes them. One per tenant and scope LEVEL.
   */
  private static final String GENERATION_PREFIX = "cache-gen:";

  /** The `SCAN ... COUNT` hint, and the batch size a `DEL` is issued at. */
  private static final int SCAN_BATCH = 200;

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
  public String buildKey(
    String organizationId,
    String scope,
    Map<String, String> params
  ) {
    Map<String, String> sorted = new TreeMap<>(
      params == null ? Map.of() : params
    );
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

    String tenant =
      organizationId == null || organizationId.isEmpty()
        ? NO_TENANT
        : organizationId;

    return PREFIX + tenant + "|" + scope + "|" + joined;
  }

  /**
   * A `SCAN`-based drop of every key under one
   * tenant's scope, never `KEYS` — a scope can hold thousands of parameter
   * combinations, and `KEYS` blocks the whole Redis event loop for the
   * duration.
   *
   * <p><b>The pattern's {@code [|:]} character class is load-bearing.</b> A
   * bare {@code scope*} glob would also delete a DIFFERENT, longer-named
   * scope that happens to share this one's prefix (e.g.
   * {@code analytics} vs. {@code analytics-graphql}). Matching the character
   * immediately after the scope name against either `|` (a bare scope, no
   * params) or `:` (a scope this project nests, e.g. `users:me`) is what
   * keeps the two apart.
   *
   * <p>Fails OPEN, same rule as {@link #wrap}: a scan or delete failure costs
   * stale entries until their TTL, never an exception a NATS handler would
   * have to catch.
   *
   * @return how many keys were removed, for a caller that only logs on a hit
   */
  public int invalidateScope(String organizationId, String scope) {
    String tenant =
      organizationId == null || organizationId.isEmpty()
        ? NO_TENANT
        : organizationId;
    // The generation first: an answer produced before now is then stored
    // where no read looks. The delete below frees the memory, and is what an
    // instance still on keys without generations understands.
    List<String> levels = generationKeys(tenant, scope);
    String generation = levels.get(levels.size() - 1);
    try {
      redis.opsForValue().increment(generation);
    } catch (RuntimeException incrementFailed) {
      LOG.error(
        "Cache generation increment failed for {}: {}",
        generation,
        incrementFailed.getMessage()
      );
    }

    String pattern = PREFIX + tenant + "|" + scope + "[|:]*";

    int removed = 0;
    try {
      List<String> batch = new ArrayList<>(SCAN_BATCH);
      try (
        Cursor<String> cursor = redis.scan(
          ScanOptions.scanOptions().match(pattern).count(SCAN_BATCH).build()
        )
      ) {
        while (cursor.hasNext()) {
          batch.add(cursor.next());
          if (batch.size() >= SCAN_BATCH) {
            removed += deleteBatch(batch);
            batch.clear();
          }
        }
      }
      if (!batch.isEmpty()) {
        removed += deleteBatch(batch);
      }
    } catch (RuntimeException scanFailed) {
      LOG.error(
        "Cache scope invalidation failed for {}: {}",
        pattern,
        scanFailed.getMessage()
      );
    }

    return removed;
  }

  private int deleteBatch(List<String> keys) {
    Long count = redis.delete(keys);
    return count == null ? 0 : count.intValue();
  }

  /**
   * Read-through, the only read path — `wrap()`, reproduced. Fails OPEN on any
   * Redis error.
   *
   * <p><b>An answer from before an invalidation is never served after it.</b>
   * The key gets the scope's generations, read BEFORE {@code produce}; an
   * invalidation increments them. An answer produced before an invalidation
   * and stored after it lands under the old generations' key, which no read
   * asks for again, and expires on its TTL. The price is one more round trip
   * per read (the generations' {@code MGET}). Generations unreadable means no
   * cache at all, never a stale answer.
   */
  public <T> T wrap(
    String key,
    long ttlSeconds,
    Class<T> type,
    Supplier<T> produce
  ) {
    Optional<String> suffix = generationSuffix(key);
    if (suffix.isEmpty()) {
      return produce.get();
    }
    key = key + suffix.get();

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
      redis
        .opsForValue()
        .set(
          key,
          json.writeValueAsString(value),
          java.time.Duration.ofSeconds(ttlSeconds)
        );
    } catch (RuntimeException cacheWriteFailed) {
      // Same fail-open rule on the write side.
    }

    return value;
  }

  /**
   * {@link #wrap}'s generic-type twin — a bare {@code Class<T>} erases a
   * parameterized type's own arguments, so a cache HIT on {@code
   * ApiResponse<PagedData<RoleResponseDto>>} would deserialize `data` as an
   * untyped map rather than the real DTOs. Needed starting with the
   * OpenAPI-ownership flip's generic envelope; every route cached before it
   * used a concrete generated class, where {@code Class<T>} was exact.
   *
   * <p>A separate NAME, not an overload of {@link #wrap} — javac's overload
   * resolution treats the two as ambiguous at every existing {@code
   * wrap(key, ttl, Foo.class, () -> …)} call site the moment a lambda is
   * the fourth argument, because it cannot commit to `Class<T>` over
   * `TypeReference<T>` before the lambda body is checked. Measured: adding
   * this as an overload broke five unrelated, already-compiling call sites
   * across the codebase with "reference to wrap is ambiguous".
   */
  public <T> T wrapTyped(
    String key,
    long ttlSeconds,
    TypeReference<T> type,
    Supplier<T> produce
  ) {
    Optional<String> suffix = generationSuffix(key);
    if (suffix.isEmpty()) {
      return produce.get();
    }
    key = key + suffix.get();

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
      redis
        .opsForValue()
        .set(
          key,
          json.writeValueAsString(value),
          java.time.Duration.ofSeconds(ttlSeconds)
        );
    } catch (RuntimeException cacheWriteFailed) {
      // Same fail-open rule on the write side.
    }

    return value;
  }

  /**
   * The generation counters a scope's keys carry, outermost first: one per
   * level, so invalidating {@code entity:user} reaches every
   * {@code entity:user:{id}} and no other entity.
   */
  static List<String> generationKeys(String tenant, String scope) {
    String[] levels = scope.split(":");
    List<String> keys = new ArrayList<>(levels.length);
    StringBuilder level = new StringBuilder();
    for (int index = 0; index < levels.length; index++) {
      if (index > 0) {
        level.append(':');
      }
      level.append(levels[index]);
      keys.add(GENERATION_PREFIX + tenant + "|" + level);
    }
    return keys;
  }

  /**
   * A built key's generations, as the suffix {@code |#g1.g2…} ({@code 0}
   * where nothing has been invalidated yet), read in ONE {@code MGET}. The
   * tenant and scope are the key's own first two segments, so callers keep
   * building keys as before. Empty when Redis can't say.
   */
  private Optional<String> generationSuffix(String key) {
    // A key not built by `buildKey` has no tenant or scope: no invalidation
    // can reach it, so it has no generation and is cached as it was.
    if (!key.startsWith(PREFIX)) {
      return Optional.of("");
    }
    String[] segments = key.substring(PREFIX.length()).split("\\|", 3);
    if (segments.length < 3) {
      return Optional.of("");
    }
    List<String> keys = generationKeys(segments[0], segments[1]);
    try {
      List<String> values = redis.opsForValue().multiGet(keys);
      StringBuilder suffix = new StringBuilder("|#");
      for (int index = 0; index < keys.size(); index++) {
        if (index > 0) {
          suffix.append('.');
        }
        String value = values == null ? null : values.get(index);
        suffix.append(value == null ? "0" : value);
      }
      return Optional.of(suffix.toString());
    } catch (RuntimeException generationsUnreadable) {
      LOG.warn(
        "Cache generations unreadable for {}: {}",
        key,
        generationsUnreadable.getMessage()
      );
      return Optional.empty();
    }
  }

  /** For a probe that needs the exact bytes rather than a decoded value. */
  public Optional<String> raw(String key) {
    return Optional.ofNullable(redis.opsForValue().get(key));
  }

  /**
   * For a probe writing an exact wire format directly, to prove this service
   * reads it.
   */
  public void putRaw(String key, String value, long ttlSeconds) {
    redis
      .opsForValue()
      .set(key, value, java.time.Duration.ofSeconds(ttlSeconds));
  }

  private static final class TaggedDateSerializer
    extends StdSerializer<OffsetDateTime>
  {

    TaggedDateSerializer() {
      super(OffsetDateTime.class);
    }

    @Override
    public void serialize(
      OffsetDateTime value,
      tools.jackson.core.JsonGenerator gen,
      SerializationContext ctx
    ) {
      gen.writeStartObject();
      gen.writeStringProperty(
        DATE_TAG,
        JsIsoFormat.PATTERN.format(value.toInstant())
      );
      gen.writeEndObject();
    }
  }

  private static final class TaggedDateDeserializer
    extends StdDeserializer<OffsetDateTime>
  {

    TaggedDateDeserializer() {
      super(OffsetDateTime.class);
    }

    @Override
    public OffsetDateTime deserialize(
      tools.jackson.core.JsonParser p,
      DeserializationContext ctx
    ) {
      JsonNode node = ctx.readTree(p);
      String iso = node.path(DATE_TAG).asString();

      return OffsetDateTime.parse(iso);
    }
  }
}
