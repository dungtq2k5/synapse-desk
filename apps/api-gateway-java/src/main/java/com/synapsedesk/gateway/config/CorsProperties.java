package com.synapsedesk.gateway.config;

import jakarta.validation.constraints.NotBlank;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * The allowed browser origins, as the one comma-separated string the
 * environment carries.
 *
 * <p>Kept as the raw string here and split where it is used, so that the
 * BOUND value is exactly what the environment said. A class that split at the
 * binding would make a malformed value look tidy — an empty element reads as
 * "origin allowed: " and is easy to miss in a list.
 *
 * @param origins the raw {@code CORS} value
 */
@Validated
@ConfigurationProperties(prefix = "cors")
public record CorsProperties(@NotBlank String origins) {}
