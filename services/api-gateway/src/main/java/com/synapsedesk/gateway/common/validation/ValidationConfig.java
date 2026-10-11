package com.synapsedesk.gateway.common.validation;

import jakarta.validation.Configuration;
import jakarta.validation.constraints.Size;
import org.hibernate.validator.HibernateValidatorConfiguration;
import org.hibernate.validator.cfg.ConstraintMapping;
import org.springframework.context.annotation.Bean;
import org.springframework.validation.beanvalidation.LocalValidatorFactoryBean;

/**
 * One correction to what the DTO classes carry: {@code @Size} extended to cover
 * {@link java.net.URI} — see {@link UriSizeValidator}.
 * {@code includeExistingValidators(true)} ADDS a validator rather than replacing
 * one, so every other {@code @Size} target ({@code String}, {@code List}, …) is
 * unaffected.
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
          hibernateConfig.addMapping(mapping);
        }
      }
    };
  }
}
