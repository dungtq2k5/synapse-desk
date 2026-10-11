package com.synapsedesk.gateway.modules.realtime;

/** The `presence:update` ack's data — just the state now in force. */
public record PresenceStatePayload(String state) {}
