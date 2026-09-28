package com.synapsedesk.gateway.validation;

import static org.assertj.core.api.Assertions.assertThat;

import com.synapsedesk.gateway.generated.model.UpdateWebhookEndpointDto;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;
import java.net.URI;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.validation.beanvalidation.LocalValidatorFactoryBean;

/**
 * The generated {@code UpdateWebhookEndpointDto.eventTypes} getter carries an
 * unconditional {@code @Size(min = 1)} that can't tell an absent JSON key
 * from an explicit {@code []} (both bind to the same default empty list) —
 * see {@link ValidationConfig}. This confirms the override actually drops
 * that one constraint, leaving every other generated {@code @Size} (e.g.
 * {@code url}) enforced as normal.
 */
class ValidationConfigTest {

  private Validator validator() {
    LocalValidatorFactoryBean factory =
      new ValidationConfig().defaultValidator();
    factory.afterPropertiesSet();
    return factory;
  }

  @Test
  void eventTypesDefaultingToEmptyDoesNotViolateSizeMinOne() {
    UpdateWebhookEndpointDto dto = new UpdateWebhookEndpointDto();

    Set<ConstraintViolation<UpdateWebhookEndpointDto>> violations =
      validator().validate(dto);

    assertThat(violations).isEmpty();
  }

  @Test
  void urlStillEnforcesItsOwnSizeBound() {
    UpdateWebhookEndpointDto dto = new UpdateWebhookEndpointDto();
    dto.setUrl(URI.create("https://example.com/" + "a".repeat(2000)));

    Set<ConstraintViolation<UpdateWebhookEndpointDto>> violations =
      validator().validate(dto);

    assertThat(violations).hasSize(1);
    assertThat(violations.iterator().next().getPropertyPath()).hasToString(
      "url"
    );
  }
}
