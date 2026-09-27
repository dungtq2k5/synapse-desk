package com.synapsedesk.gateway.analytics;

import java.util.List;

/** `DocumentAnalytics` — `Query.analyticsDocuments`'s return type. */
public record DocumentAnalyticsGqlDto(
    RateGqlDto citationAccuracy,
    String dataThrough,
    List<DocumentUsageGqlDto> mostCited,
    List<DocumentUsageGqlDto> neverRetrieved,
    List<DocumentUsageGqlDto> retrievedNeverCited,
    List<UnavailableBlockGqlDto> unavailable) {}
