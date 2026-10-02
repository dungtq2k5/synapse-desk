package com.synapsedesk.gateway.validation;

import com.synapsedesk.gateway.model.UpdateWebhookEndpointDto;
import jakarta.validation.Configuration;
import jakarta.validation.constraints.Size;
import org.hibernate.validator.HibernateValidatorConfiguration;
import org.hibernate.validator.cfg.ConstraintMapping;
import org.springframework.context.annotation.Bean;
import org.springframework.validation.beanvalidation.LocalValidatorFactoryBean;

/**
 * Two corrections to what the generated {@code *Api} DTOs carry, neither
 * fixable at the source since generated code regenerates on every build:
 *
 * <ul>
 *   <li>{@code @Size} extended to cover {@link java.net.URI} — see {@link
 *       UriSizeValidator}. {@code includeExistingValidators(true)} ADDS a
 *       validator rather than replacing one, so every other {@code @Size}
 *       target ({@code String}, {@code List}, …) is unaffected.
 *   <li>{@code UpdateWebhookEndpointDto.eventTypes} defaults to {@code new
 *       ArrayList<>()} (not {@code null}) with an unconditional {@code
 *       @Size(min = 1)}. Jackson never calls the setter when the JSON key
 *       is absent, so "absent" and "explicit `[]`" bind to the identical
 *       empty list — Bean Validation cannot tell them apart, and rejects
 *       the "absent" case with 400 before {@code WebhookEndpointsController}
 *       ever reaches its own raw-body presence check. `ignoreAnnotations`
 *       drops the generated constraint for this one property only; the
 *       controller now owns the "empty array is refused, absent is not"
 *       rule itself, the same way it already owns "absent leaves the wire
 *       field unset."
 * </ul>
 */
@org.springframework.context.annotation.Configuration
public class ValidationConfig {

  @Bean
  public LocalValidatorFactoryBean defaultValidator() {
    return new LocalValidatorFactoryBean() {
      @Override
      protected void postProcessConfiguration(Configuration<?> configuration) {
        if (
          configuration instanceof
            HibernateValidatorConfiguration hibernateConfig
        ) {
          ConstraintMapping mapping = hibernateConfig.createConstraintMapping();
          mapping
            .constraintDefinition(Size.class)
            .includeExistingValidators(true)
            .validatedBy(UriSizeValidator.class);
          mapping
            .type(UpdateWebhookEndpointDto.class)
            .getter("eventTypes")
            .ignoreAnnotations(true);
          hibernateConfig.addMapping(mapping);
        }
      }
    };
  }
}
