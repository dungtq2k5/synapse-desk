package com.synapsedesk.gateway.common.openapi;

import static org.assertj.core.api.Assertions.assertThat;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.Operation;
import io.swagger.v3.oas.models.PathItem;
import io.swagger.v3.oas.models.Paths;
import io.swagger.v3.oas.models.media.ArraySchema;
import io.swagger.v3.oas.models.media.IntegerSchema;
import io.swagger.v3.oas.models.media.ObjectSchema;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.media.StringSchema;
import io.swagger.v3.oas.models.parameters.Parameter;
import java.math.BigDecimal;
import org.junit.jupiter.api.Test;

/**
 * The rule: a length or item bound that only restates its annotation's default is
 * dropped, anywhere, and a bound anyone wrote is left alone. No test names a field,
 * because the customizer does not.
 */
class DefaultBoundsOpenApiCustomizerTest {

  private final DefaultBoundsOpenApiCustomizer customizer =
    new DefaultBoundsOpenApiCustomizer();

  private static OpenAPI documentWith(Schema<?> root) {
    return new OpenAPI().components(
      new Components().addSchemas("Subject", root)
    );
  }

  @Test
  void aMaximumAtTheIntegerCeilingIsDroppedFromLengthAndItems() {
    StringSchema text = new StringSchema();
    text.setMaxLength(Integer.MAX_VALUE);
    ArraySchema list = new ArraySchema();
    list.setMaxItems(Integer.MAX_VALUE);
    ObjectSchema root = new ObjectSchema();
    root.addProperty("text", text);
    root.addProperty("list", list);

    customizer.customise(documentWith(root));

    assertThat(text.getMaxLength()).isNull();
    assertThat(list.getMaxItems()).isNull();
  }

  @Test
  void aMinimumOfZeroIsDroppedFromLengthAndItems() {
    StringSchema text = new StringSchema();
    text.setMinLength(0);
    ArraySchema list = new ArraySchema();
    list.setMinItems(0);
    ObjectSchema root = new ObjectSchema();
    root.addProperty("text", text);
    root.addProperty("list", list);

    customizer.customise(documentWith(root));

    assertThat(text.getMinLength()).isNull();
    assertThat(list.getMinItems()).isNull();
  }

  @Test
  void aBoundSomeoneWroteIsLeftAlone() {
    StringSchema text = new StringSchema();
    text.setMinLength(1);
    text.setMaxLength(500);
    ArraySchema list = new ArraySchema();
    list.setMinItems(1);
    list.setMaxItems(50);
    ObjectSchema root = new ObjectSchema();
    root.addProperty("text", text);
    root.addProperty("list", list);

    customizer.customise(documentWith(root));

    assertThat(text.getMinLength()).isEqualTo(1);
    assertThat(text.getMaxLength()).isEqualTo(500);
    assertThat(list.getMinItems()).isEqualTo(1);
    assertThat(list.getMaxItems()).isEqualTo(50);
  }

  @Test
  void aNumericMinimumOfZeroIsAWrittenValueAndStays() {
    IntegerSchema count = new IntegerSchema();
    count.setMinimum(BigDecimal.ZERO);
    ObjectSchema root = new ObjectSchema();
    root.addProperty("count", count);

    customizer.customise(documentWith(root));

    assertThat(count.getMinimum()).isEqualByComparingTo(BigDecimal.ZERO);
  }

  @Test
  void itReachesNestedItemsAndParameterSchemas() {
    StringSchema element = new StringSchema();
    element.setMaxLength(Integer.MAX_VALUE);
    ArraySchema list = new ArraySchema();
    list.setItems(element);
    ObjectSchema root = new ObjectSchema();
    root.addProperty("list", list);

    StringSchema queryValue = new StringSchema();
    queryValue.setMinLength(0);
    Operation operation = new Operation().addParametersItem(
      new Parameter().name("q").in("query").schema(queryValue)
    );
    OpenAPI document = documentWith(root).paths(
      new Paths().addPathItem("/x", new PathItem().get(operation))
    );

    customizer.customise(document);

    assertThat(element.getMaxLength()).isNull();
    assertThat(queryValue.getMinLength()).isNull();
  }
}
