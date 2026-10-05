package com.synapsedesk.gateway.realtime;

/** The {@code ai:stream:cancel} ack's data — {@code false} for an unknown/foreign streamId, never an error. */
public record CancelledPayload(boolean cancelled) {}
