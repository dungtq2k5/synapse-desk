package com.synapsedesk.gateway.modules.realtime;

/** The `connection:refused` payload: why the socket is about to be disconnected. */
public record ConnectionRefusedPayload(String code) {}
