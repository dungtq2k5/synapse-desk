package com.synapsedesk.gateway.realtime;

/**
 * `WsResponse<T>` from `libs/common`'s `ws-response.interface.ts`, reproduced
 * — every server-to-client emit the gateway owns wraps its payload the same
 * way, `{success, message, data}`, so a client written against Node needs no
 * branch for which implementation answered it.
 */
public record WsResponse<T>(boolean success, String message, T data) {
  public static <T> WsResponse<T> ok(String message, T data) {
    return new WsResponse<>(true, message, data);
  }

  public static WsResponse<Void> fail(String message) {
    return new WsResponse<>(false, message, null);
  }
}
