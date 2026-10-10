package com.synapsedesk.gateway.realtime;

/**
 * Every server-to-client emit the gateway owns wraps its payload the same
 * way, `{success, message, data}`, so a client reads every frame with one
 * shape.
 */
public record WsResponse<T>(boolean success, String message, T data) {
  public static <T> WsResponse<T> ok(String message, T data) {
    return new WsResponse<>(true, message, data);
  }

  public static WsResponse<Void> fail(String message) {
    return new WsResponse<>(false, message, null);
  }
}
