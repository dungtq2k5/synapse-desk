package com.synapsedesk.gateway;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

/**
 * The Java gateway's entry point.
 *
 * <p>Deliberately bare at this step: it boots, and nothing else. Routing,
 * the envelope, the error mapping and the lease arrive in their own steps,
 * each with the test that holds them — a skeleton that already carried half a
 * gateway would be a skeleton nobody could review.
 *
 * <p><b>No {@code .env} loading, here or anywhere in this module.</b> Spring
 * does not read {@code .env} files (measured — plan 81 §9, J1), and nothing
 * is added to make it: under Kubernetes and Compose the values are already
 * environment variables, and locally the launcher reads the file and execs
 * this process with it. One loader, in the language that already has the
 * parser.
 */
@SpringBootApplication
// Binds and VALIDATES every `@ConfigurationProperties` record under
// `config/` at context refresh — the point at which a missing key must
// refuse, before anything listens.
@ConfigurationPropertiesScan
public class GatewayApplication {
  public static void main(String[] args) {
    SpringApplication.run(GatewayApplication.class, args);
  }
}
