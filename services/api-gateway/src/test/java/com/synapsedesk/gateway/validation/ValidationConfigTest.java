package com.synapsedesk.gateway.validation;

import static org.assertj.core.api.Assertions.assertThat;

import com.synapsedesk.gateway.model.UpdateWebhookEndpointDto;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;
import java.net.URI;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.validation.beanvalidation.LocalValidatorFactoryBean;

/**
 * {@code UpdateWebhookEndpointDto.eventTypes} carries {@code @Size(min = 1)} and
 * no default, so the constraint only ever sees a value the client sent: absent
 * is valid, an explicit {@code []} is not. {@code url}'s {@code @Size} on a
 * {@code URI} is enforced by {@link UriSizeValidator}.
 */
class ValidationConfigTest {

  private Validator validator() {
    LocalValidatorFactoryBean factory =
      new ValidationConfig().defaultValidator();
    factory.afterPropertiesSet();
    return factory;
  }

  @Test
  void anAbsentEventTypesIsValid() {
    UpdateWebhookEndpointDto dto = new UpdateWebhookEndpointDto();

    assertThat(dto.getEventTypes()).isNull();
    assertThat(validator().validate(dto)).isEmpty();
  }

  @Test
  void anExplicitEmptyEventTypesIsRefused() {
    UpdateWebhookEndpointDto dto = new UpdateWebhookEndpointDto();
    dto.setEventTypes(List.of());

    Set<ConstraintViolation<UpdateWebhookEndpointDto>> violations =
      validator().validate(dto);

    assertThat(violations).hasSize(1);
    assertThat(violations.iterator().next().getPropertyPath()).hasToString(
      "eventTypes"
    );
  }

  @Test
  void aNonEmptyEventTypesIsValid() {
    UpdateWebhookEndpointDto dto = new UpdateWebhookEndpointDto();
    dto.setEventTypes(
      List.of(UpdateWebhookEndpointDto.EventTypesEnum.TICKET_ASSIGNED)
    );

    assertThat(validator().validate(dto)).isEmpty();
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
