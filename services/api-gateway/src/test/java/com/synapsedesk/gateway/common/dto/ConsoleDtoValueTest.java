package com.synapsedesk.gateway.common.dto;

import static org.assertj.core.api.Assertions.assertThat;

import com.synapsedesk.gateway.modules.auditlogs.dto.rest.AuditLogResponseDto;
import com.synapsedesk.gateway.modules.auditlogs.dto.rest.PlatformAuditLogResponseDto;
import com.synapsedesk.gateway.modules.auth.dto.rest.TwoFactorRequiredResponseDto;
import com.synapsedesk.gateway.modules.platform.dto.rest.DunningTenantResponseDto;
import com.synapsedesk.gateway.modules.platform.dto.rest.OverLimitItemResponseDto;
import com.synapsedesk.gateway.modules.platform.dto.rest.PlanSubscriberProjectionResponseDto;
import com.synapsedesk.gateway.modules.platform.dto.rest.PlatformOrganizationDetailResponseDto;
import com.synapsedesk.gateway.modules.platform.dto.rest.PlatformOrganizationResponseDto;
import com.synapsedesk.gateway.modules.platform.dto.rest.PlatformOrganizationStatusResponseDto;
import com.synapsedesk.gateway.modules.platformjobs.dto.rest.RunJobDto;
import java.lang.reflect.Method;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;
import java.util.stream.Stream;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

/**
 * The platform console's DTOs as values, field by field: two filled alike are
 * equal with one hash; changing any one field through its setter breaks
 * equality; every getter reads what its setter wrote; {@code toString} names
 * every field (it's what a failed assertion prints).
 */
class ConsoleDtoValueTest {

  static Stream<Class<?>> dtos() {
    return Stream.of(
      CurrentUserResponseDto.class,
      TwoFactorRequiredResponseDto.class,
      RunJobDto.class,
      OverLimitItemResponseDto.class,
      PlanSubscriberProjectionResponseDto.class,
      PlatformOrganizationResponseDto.class,
      PlatformOrganizationDetailResponseDto.class,
      PlatformOrganizationStatusResponseDto.class,
      DunningTenantResponseDto.class,
      PlatformAuditLogResponseDto.class
    );
  }

  @ParameterizedTest
  @MethodSource("dtos")
  void isAValueFieldByField(Class<?> type) throws Exception {
    Object a = filled(type, 1);
    Object b = filled(type, 1);

    assertThat(a).isEqualTo(b).hasSameHashCodeAs(b).isEqualTo(a);
    assertThat(a).isNotEqualTo(null).isNotEqualTo(new Object());

    for (Method setter : setters(type)) {
      Object changed = filled(type, 1);
      setter.invoke(changed, sample(setter.getParameterTypes()[0], 2));
      assertThat(changed).as(setter.getName()).isNotEqualTo(a);

      String field = setter.getName().substring(3);
      Method getter = type.getMethod("get" + field);
      assertThat(getter.invoke(changed)).isEqualTo(
        sample(setter.getParameterTypes()[0], 2)
      );
      assertThat(a.toString()).contains(
        Character.toLowerCase(field.charAt(0)) + field.substring(1)
      );
    }
  }

  @ParameterizedTest
  @MethodSource("dtos")
  void fluentCallsBuildWhatSettersBuild(Class<?> type) throws Exception {
    Object bySetters = filled(type, 1);
    Object fluent = type.getConstructor().newInstance();
    for (Method setter : setters(type)) {
      String field = setter.getName().substring(3);
      String name = Character.toLowerCase(field.charAt(0)) + field.substring(1);
      Method withValue;
      try {
        withValue = type.getMethod(name, setter.getParameterTypes()[0]);
      } catch (NoSuchMethodException inherited) {
        setter.invoke(fluent, sample(setter.getParameterTypes()[0], 1));
        continue;
      }
      withValue.invoke(fluent, sample(setter.getParameterTypes()[0], 1));
    }
    assertThat(fluent).isEqualTo(bySetters);
  }

  @org.junit.jupiter.api.Test
  void aPlatformEntryCopiesTheTenantEntryItWasMadeFrom() throws Exception {
    AuditLogResponseDto entry = (AuditLogResponseDto) filled(
      AuditLogResponseDto.class,
      1
    );

    PlatformAuditLogResponseDto named = PlatformAuditLogResponseDto.of(entry);

    for (Method setter : setters(AuditLogResponseDto.class)) {
      Method getter = AuditLogResponseDto.class.getMethod(
        "get" + setter.getName().substring(3)
      );
      assertThat(getter.invoke(named)).isEqualTo(getter.invoke(entry));
    }
    assertThat(named.getActorName()).isNull();
  }

  private static List<Method> setters(Class<?> type) {
    return Arrays.stream(type.getMethods())
      .filter(m -> m.getName().startsWith("set") && m.getParameterCount() == 1)
      .toList();
  }

  private static Object filled(Class<?> type, int seed) throws Exception {
    Object value = type.getConstructor().newInstance();
    for (Method setter : setters(type)) {
      setter.invoke(value, sample(setter.getParameterTypes()[0], seed));
    }
    return value;
  }

  private static final Map<
    Class<?>,
    java.util.function.IntFunction<Object>
  > SAMPLES = Map.of(
    String.class,
    seed -> "v" + seed,
    Boolean.class,
    seed -> seed == 1,
    BigDecimal.class,
    BigDecimal::valueOf,
    OffsetDateTime.class,
    seed -> OffsetDateTime.of(2026, 10, seed, 0, 0, 0, 0, ZoneOffset.UTC),
    List.class,
    seed -> List.of(),
    Map.class,
    seed -> Map.of("k", seed == 1 ? "a" : "b")
  );

  private static Object sample(Class<?> type, int seed) throws Exception {
    if (type.isEnum()) {
      Object[] values = type.getEnumConstants();
      return values[(seed - 1) % values.length];
    }
    if (type == List.class) {
      return seed == 1 ? List.of() : List.of("x");
    }
    if (type == java.net.URI.class) {
      return java.net.URI.create("https://example.test/" + seed);
    }
    if (type == java.util.UUID.class) {
      return new java.util.UUID(0, seed);
    }
    var known = SAMPLES.get(type);
    if (known != null) return known.apply(seed);
    // A nested DTO: a fresh one differs from a filled one.
    Supplier<Object> fresh = () -> {
      try {
        return type.getConstructor().newInstance();
      } catch (ReflectiveOperationException e) {
        throw new IllegalStateException(e);
      }
    };
    return seed == 1 ? fresh.get() : filled(type, 1);
  }
}
