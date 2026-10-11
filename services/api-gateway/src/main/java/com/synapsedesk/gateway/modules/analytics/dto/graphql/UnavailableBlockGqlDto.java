package com.synapsedesk.gateway.modules.analytics.dto.graphql;

/** `UnavailableBlock` — one leg of a composed answer that failed, and why. */
public record UnavailableBlockGqlDto(String source, String reason) {}
