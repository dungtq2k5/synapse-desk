package com.synapsedesk.gateway.realtime;

import com.synapsedesk.gateway.contracts.RealtimeEvents;
import java.util.Map;

/**
 * `WS_EVENT_LIMITS`, reproduced — one entry per client-to-server event,
 * shared across every handler rather than a literal at each call site.
 */
public final class WsEventLimits {

  private WsEventLimits() {}

  public record Limit(int count, long ttlMs) {}

  private static final long WINDOW_MS = 60_000;

  private static final Map<String, Limit> LIMITS = Map.of(
    RealtimeEvents.CLIENT_EVENTS_TICKET_JOIN,
    new Limit(60, WINDOW_MS),
    RealtimeEvents.CLIENT_EVENTS_TICKET_LEAVE,
    new Limit(120, WINDOW_MS),
    RealtimeEvents.CLIENT_EVENTS_MESSAGE_SEND,
    new Limit(30, WINDOW_MS),
    RealtimeEvents.CLIENT_EVENTS_TYPING_START,
    new Limit(240, WINDOW_MS),
    RealtimeEvents.CLIENT_EVENTS_TYPING_STOP,
    new Limit(240, WINDOW_MS),
    RealtimeEvents.CLIENT_EVENTS_PRESENCE_UPDATE,
    new Limit(120, WINDOW_MS),
    RealtimeEvents.CLIENT_EVENTS_AI_STREAM_CANCEL,
    new Limit(60, WINDOW_MS)
  );

  public static Limit of(String event) {
    Limit limit = LIMITS.get(event);
    if (limit == null) {
      throw new IllegalStateException("No WS event limit declared for " + event);
    }

    return limit;
  }
}
