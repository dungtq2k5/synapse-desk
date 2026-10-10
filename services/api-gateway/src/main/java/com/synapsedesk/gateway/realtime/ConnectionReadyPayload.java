package com.synapsedesk.gateway.realtime;

/** The `connection:ready` payload — exactly these two fields, no more. */
public record ConnectionReadyPayload(String userId, String organizationId) {}
