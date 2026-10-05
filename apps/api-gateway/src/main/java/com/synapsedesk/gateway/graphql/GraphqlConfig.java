package com.synapsedesk.gateway.graphql;

import com.synapsedesk.gateway.config.RuntimeProperties;
import graphql.introspection.Introspection;
import jakarta.annotation.PostConstruct;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.graphql.execution.RuntimeWiringConfigurer;

/**
 * The `DateTime` scalar, and introspection off in production —
 * `graphql.config.ts`'s two hand-wired decisions once schema, limits and
 * loaders are all things Spring for GraphQL reads or collects on its own.
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
   * **OFF in production**, matching `introspection: !isProduction`. JVM-wide
   * rather than per-request — graphql-java has no per-request switch — which
   * is the same shape as Node's: one process, one deployment, one answer.
   */
  @PostConstruct
  void configureIntrospection() {
    if ("production".equals(runtime.nodeEnv())) {
      Introspection.enabledJvmWide(false);
    }
  }
}
