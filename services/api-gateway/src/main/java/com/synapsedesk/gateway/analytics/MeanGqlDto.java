package com.synapsedesk.gateway.analytics;

/** `Mean` — `null` means no rows, never a mean of zero. */
public record MeanGqlDto(Double mean, int count) {}
