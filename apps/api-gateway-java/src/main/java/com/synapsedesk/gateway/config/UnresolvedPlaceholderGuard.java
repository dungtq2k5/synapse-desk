package com.synapsedesk.gateway.config;

import org.springframework.boot.context.properties.ConfigurationPropertiesBindHandlerAdvisor;
import org.springframework.boot.context.properties.bind.AbstractBindHandler;
import org.springframework.boot.context.properties.bind.BindContext;
import org.springframework.boot.context.properties.bind.BindHandler;
import org.springframework.boot.context.properties.bind.Bindable;
import org.springframework.boot.context.properties.source.ConfigurationPropertyName;
import org.springframework.stereotype.Component;

/**
 * Refuses a value that is still an unresolved {@code ${...}} placeholder.
 *
 * <p><b>Measured, not assumed, and it is the reason this class exists.</b> The
 * binder resolves placeholders with unresolvable ones IGNORED, so a key that
 * is simply absent from the environment does not fail: the field binds to the
 * literal text {@code ${INBOUND_EMAIL_SECRET}}, which is not blank, so
 * {@code @NotBlank} passes and the gateway boots with a secret whose value is
 * the name of the secret. That is worse than a crash — it is a gateway that
 * starts, serves, and compares signatures against a placeholder.
 *
 * <p>So absence is caught HERE and emptiness by {@code @NotBlank}; together
 * they are the Joi schema's {@code required()}. Both run at context refresh,
 * before anything listens.
 *
 * <p>The message names the ENVIRONMENT VARIABLE, not just the property: the
 * literal placeholder still contains it, and the variable is the name the
 * person fixing this has in their hand.
 */
@Component
public class UnresolvedPlaceholderGuard implements ConfigurationPropertiesBindHandlerAdvisor {

  @Override
  public BindHandler apply(BindHandler parent) {
    return new AbstractBindHandler(parent) {
      @Override
      public Object onSuccess(
          ConfigurationPropertyName name, Bindable<?> target, BindContext context, Object result) {
        if (result instanceof String value
            && value.startsWith("${")
            && value.endsWith("}")) {
          throw new IllegalStateException(
              "%s is unset: nothing resolved %s. Set it in the environment — both gateways read %s."
                  .formatted(name, value, "apps/api-gateway/.env.example"));
        }

        return super.onSuccess(name, target, context, result);
      }
    };
  }
}
