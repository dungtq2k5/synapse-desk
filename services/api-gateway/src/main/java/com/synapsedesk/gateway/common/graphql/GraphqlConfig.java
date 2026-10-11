package com.synapsedesk.gateway.common.graphql;

import com.synapsedesk.gateway.common.config.RuntimeProperties;
import graphql.introspection.Introspection;
import jakarta.annotation.PostConstruct;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.graphql.execution.RuntimeWiringConfigurer;

/**
 * The `DateTime` scalar, and introspection off in production — the two
 * hand-wired decisions; schema, limits and loaders are all things Spring for
 * GraphQL reads or collects on its own.
 */
@Configuration
public class GraphqlConfig {

  private final RuntimeProperties runtime;

  public GraphqlConfig(RuntimeProperties runtime) {
    this.runtime = runtime;
  }

  @Bean
  RuntimeWiringConfigurer dateTimeScalarConfigurer() {
    return builder -> builder.scalar(DateTimeScalar.TYPE);
  }

  /**
   * **OFF in production** (`NODE_ENV=production`). JVM-wide rather than
   * per-request — graphql-java has no per-request switch — which fits: one
   * process, one deployment, one answer.
   */
  @PostConstruct
  void configureIntrospection() {
    if ("production".equals(runtime.nodeEnv())) {
      Introspection.enabledJvmWide(false);
    }
  }
}
