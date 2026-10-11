package com.synapsedesk.gateway.modules.analytics.dto.graphql;

/** `Mean` — `null` means no rows, never a mean of zero. */
public record MeanGqlDto(Double mean, int count) {}
