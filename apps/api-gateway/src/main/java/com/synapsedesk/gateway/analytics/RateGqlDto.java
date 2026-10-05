package com.synapsedesk.gateway.analytics;

/** `Rate` — `null` means no denominator, never a rate of zero. */
public record RateGqlDto(Double rate, int numerator, int denominator) {}
