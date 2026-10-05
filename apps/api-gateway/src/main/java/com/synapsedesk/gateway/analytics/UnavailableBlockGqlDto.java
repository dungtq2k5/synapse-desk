package com.synapsedesk.gateway.analytics;

/** `UnavailableBlock` — one leg of a composed answer that failed, and why. */
public record UnavailableBlockGqlDto(String source, String reason) {}
