package com.synapsedesk.gateway.lease;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * The lease's runtime while the skeleton has nothing to start.
 *
 * <p><b>It logs rather than doing nothing silently.</b> A standby is supposed
 * to consume no NATS subject and accept no socket; today it consumes and
 * accepts nothing because neither exists yet, and those two facts look
 * identical from the outside. The log line is what tells a reader which one
 * they are looking at, and `@ConditionalOnMissingBean` means the real runtime
 * replaces this the moment it is written.
 */
@Configuration
public class InertRuntime {

  private static final Logger LOG = LoggerFactory.getLogger(InertRuntime.class);

  @Bean
  @ConditionalOnMissingBean(LeaseRuntime.class)
  LeaseRuntime nothingToStartYet() {
    return new LeaseRuntime() {
      @Override
      public void activate() {
        LOG.info("Lease claimed; nothing to start yet (no NATS consumer, no socket server)");
      }

      @Override
      public void deactivate() {
        LOG.info("Lease lost; nothing to stop yet");
      }
    };
  }
}
