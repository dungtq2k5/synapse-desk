package com.synapsedesk.gateway.common.config;

import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;
import java.math.BigDecimal;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.boot.jackson.autoconfigure.JsonMapperBuilderCustomizer;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

/**
 * Reads an explicit {@code null} for a list, a map, a number or a boolean as ABSENT, in
 * what the application's mapper reads: a property keeps its default ({@code tags = new
 * ArrayList<>()}) rather than being overwritten with a {@code null} the code then
 * dereferences.
 *
 * <p>{@code Nulls.SKIP} is a rule per TYPE, not a list of fields, so the next list a
 * class declares is covered. Objects are NOT covered: a {@code null} there may be the
 * value.
 *
 * <p>A request body's optional field never reaches this rule: it refuses an explicit
 * {@code null} ({@link StrictRequestBodyConverter}), and a property's own setting beats
 * a per-type one. A required field's {@code null} is skipped here and refused by its
 * {@code @NotNull}.
 */
@Component
public class ExplicitNullJsonCustomizer implements JsonMapperBuilderCustomizer {

  /** The property types whose explicit null is the same as the key being absent. */
  static final List<Class<?>> NULL_IS_ABSENT = List.of(
    List.class,
    Set.class,
    Collection.class,
    Map.class,
    BigDecimal.class,
    Boolean.class
  );

  @Override
  public void customize(JsonMapper.Builder builder) {
    for (Class<?> type : NULL_IS_ABSENT) {
      builder.withConfigOverride(type, override ->
        override.setNullHandling(JsonSetter.Value.forValueNulls(Nulls.SKIP))
      );
    }
  }
}
