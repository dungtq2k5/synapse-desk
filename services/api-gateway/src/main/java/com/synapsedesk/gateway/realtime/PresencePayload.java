package com.synapsedesk.gateway.realtime;

/** `PresencePayloadDto` — the `REALTIME_EVENTS.presence` frame's data. */
public record PresencePayload(String userId, String state) {}
