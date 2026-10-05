package com.synapsedesk.gateway.realtime;

/** `ConnectionReadyPayloadDto` — exactly the two fields Node emits, no more. */
public record ConnectionReadyPayload(String userId, String organizationId) {}
