package com.synapsedesk.gateway.modules.analytics.dto.graphql;

/** `Rate` — `null` means no denominator, never a rate of zero. */
public record RateGqlDto(Double rate, int numerator, int denominator) {}
