package com.synapsedesk.gateway.common.openapi;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** The rule: a handler's camel-case name is re-spelled as the published id. */
class OperationIdCustomizerTest {

  @Test
  void aVersionedHandlerGetsAnUnderscoreVersionSuffix() {
    assertThat(
      OperationIdCustomizer.publishedId("departmentsControllerListV1")
    ).isEqualTo("DepartmentsController_list_v1");
  }

  @Test
  void anUnversionedHandlerHasNoSuffix() {
    assertThat(
      OperationIdCustomizer.publishedId("opsControllerHealth")
    ).isEqualTo("OpsController_health");
  }

  @Test
  void aMethodNameOfSeveralWordsKeepsItsInnerCapitals() {
    assertThat(
      OperationIdCustomizer.publishedId("authControllerRotateSecretV1")
    ).isEqualTo("AuthController_rotateSecret_v1");
  }

  @Test
  void aNameWithoutAControllerIsLeftToSpringdoc() {
    assertThat(OperationIdCustomizer.publishedId("somethingElse")).isNull();
  }
}
