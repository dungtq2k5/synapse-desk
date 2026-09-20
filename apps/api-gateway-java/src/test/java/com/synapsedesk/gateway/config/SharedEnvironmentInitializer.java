package com.synapsedesk.gateway.config;

import java.util.HashMap;
import java.util.Map;
import org.springframework.context.ApplicationContextInitializer;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.MapPropertySource;

/**
 * Puts the shared {@code .env.example} into a {@code @SpringBootTest}
 * context.
 *
 * <p>An initializer rather than a generated {@code .properties} file on the
 * test classpath: a generated copy is still a copy, and the whole point of
 * {@link SharedEnvironment} is that there is exactly one file. It is added at
 * LOW precedence, so a row's own {@code properties = …} still wins.
 */
public class SharedEnvironmentInitializer
    implements ApplicationContextInitializer<ConfigurableApplicationContext> {

  @Override
  public void initialize(ConfigurableApplicationContext context) {
    Map<String, Object> values = new HashMap<>(SharedEnvironment.values());

    context
        .getEnvironment()
        .getPropertySources()
        .addLast(new MapPropertySource("shared-env-example", values));
  }
}
