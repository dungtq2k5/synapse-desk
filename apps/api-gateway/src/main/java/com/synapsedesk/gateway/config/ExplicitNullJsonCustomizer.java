package com.synapsedesk.gateway.config;

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
 * Reads an explicit {@code null} for a list, a map or a number as ABSENT.
 *
 * <p>The DTOs give an optional collection an empty default ({@code roleIds = new
 * ArrayList<>()}) and an optional number its own ({@code limit = 0}), so a field the
 * client leaves out keeps it. But Jackson calls the setter with {@code null} when the
 * client sends the key with a null value, which overwrites the default, and the
 * handler then dereferences it: a 500 on a valid request, which should be answered
 * as if the field were absent. Measured: 12 optional fields crashed that way.
 *
 * <p>{@code Nulls.SKIP} makes Jackson skip the call, so the field keeps what absent
 * would have given it. It is a rule per TYPE, not a list of fields, so the next
 * optional list a DTO declares is covered. Booleans and objects are deliberately NOT
 * covered: for them an explicit {@code null} can mean something of its own (an explicit
 * {@code isActive: null} reads as false, not as its default of true), and each such field
 * has its own contract row.
 */
@Component
public class ExplicitNullJsonCustomizer implements JsonMapperBuilderCustomizer {

  /** The property types whose explicit null is the same as the key being absent. */
  static final List<Class<?>> NULL_IS_ABSENT = List.of(
    List.class,
    Set.class,
    Collection.class,
    Map.class,
    BigDecimal.class
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
