package com.synapsedesk.gateway.web;

import org.springframework.lang.Nullable;

/**
 * The success envelope every REST route answers with — one generic type,
 * not the ~150 structurally-identical per-endpoint classes OpenAPI
 * Generator produced from the old document (`AuthControllerForgotPasswordV1202Response`
 * and its siblings). Those were never a real contract: the SHAPE — this
 * record — is the contract, and a generated per-endpoint name was always an
 * artifact of how the document used to be produced, not a decision anyone
 * made.
 *
 * <p><b>Five fields, not four.</b> {@code warning} is easy to drop rebuilding
 * this by hand — it carries no example value worth noticing, unlike
 * {@code success}/{@code statusCode}/{@code message} — but it is load-bearing
 * on real routes: a degraded search, a partially-applied bulk operation, a
 * public-domain warning on an updated setting. {@code required} on the wire
 * is the other four; {@code warning} is nullable and absent means nothing to
 * say.
 *
 * @param data required as a KEY even when its value is {@code null} — never
 *     omitted, which is why this type carries no {@code @JsonInclude}
 *     override of its own.
 */
public record ApiResponse<T>(
  boolean success,
  int statusCode,
  String message,
  @Nullable String warning,
  T data
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
