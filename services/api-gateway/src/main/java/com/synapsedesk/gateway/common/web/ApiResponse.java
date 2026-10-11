package com.synapsedesk.gateway.common.web;

import jakarta.validation.constraints.NotNull;
import org.jspecify.annotations.Nullable;

/**
 * The success envelope every REST route answers with — one generic type for
 * every route. The SHAPE — this record — is the contract; there is no
 * per-endpoint envelope class, so a route's schema name is {@code
 * ApiResponse<ItsData>} and nothing is named after the controller method.
 *
 * <p><b>Five fields, not four.</b> {@code warning} is easy to drop rebuilding
 * this by hand — it carries no example value worth noticing, unlike
 * {@code success}/{@code statusCode}/{@code message} — but it is load-bearing
 * on real routes: a degraded search, a partially-applied bulk operation, a
 * public-domain warning on an updated setting. {@code required} on the wire
 * is the other four; {@code warning} is nullable and absent means nothing to
 * say.
 *
 * <p><b>{@code @NotNull} documents here; it does not validate.</b> Nothing checks an
 * outgoing body, so on this type the annotation only tells the published document
 * that the property is required and never null (see {@code
 * ResponseSchemasOpenApiCustomizer}, which publishes a response property without it
 * as possibly null). It is not redundant: removing it changes the published
 * contract.
 *
 * @param data required as a KEY even when its value is {@code null} — never
 *     omitted, which is why this type carries no {@code @JsonInclude}
 *     override of its own.
 */
public record ApiResponse<T>(
  @NotNull boolean success,
  @NotNull int statusCode,
  @NotNull String message,
  @Nullable String warning,
  @NotNull T data
) {
  public static <T> ApiResponse<T> of(int statusCode, String message, T data) {
    return new ApiResponse<>(true, statusCode, message, null, data);
  }

  public static <T> ApiResponse<T> of(
    int statusCode,
    String message,
    String warning,
    T data
  ) {
    return new ApiResponse<>(true, statusCode, message, warning, data);
  }
}
