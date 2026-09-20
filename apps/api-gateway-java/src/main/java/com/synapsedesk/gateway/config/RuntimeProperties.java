package com.synapsedesk.gateway.config;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * Section 1 and 2 of the shared environment: runtime and build identity.
 *
 * <p><b>{@code @Validated} is the refusal mechanism, not the placeholder.</b>
 * Measured in step 2: a bare {@code ${PORT}} on {@code server.port} does not
 * refuse in a non-web context, because that key is read when the servlet
 * container starts. These constraints run at CONTEXT REFRESH, before anything
 * listens — which is where the Joi schema's {@code required()} runs on the
 * Node side.
 *
 * @param nodeEnv which environment this is; the Node schema restricts it to a
 *     known set, and so does {@link #nodeEnv()}'s caller
 * @param port the public HTTP listener
 * @param globalPrefix the prefix ALONE — URI versioning adds the version
 * @param swaggerEnabled defaults to FALSE, so an environment that never
 *     considered the question is closed rather than open
 * @param appVersion baked at image build time, never read from git at runtime
 * @param buildSha the commit this image was built from
 * @param buildTime ISO-8601, baked with the sha
 */
@Validated
@ConfigurationProperties(prefix = "runtime")
public record RuntimeProperties(
    @NotBlank String nodeEnv,
    @NotNull Integer port,
    @NotBlank String globalPrefix,
    @NotNull Boolean swaggerEnabled,
    @NotBlank String appVersion,
    @NotBlank String buildSha,
    @NotBlank String buildTime) {}
