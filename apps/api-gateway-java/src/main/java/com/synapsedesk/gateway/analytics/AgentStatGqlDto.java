package com.synapsedesk.gateway.analytics;

/**
 * `AgentStat` — no `fullName`/`agent` resolved here. Unlike the REST route,
 * which hydrates names in a third gRPC leg, `AgentStat.agent` resolves
 * through the users loader on demand — a numbers-only query costs no call
 * to auth-service at all.
 */
public record AgentStatGqlDto(
    String agentId, int assigned, int resolved, int messagesSent, MeanGqlDto resolutionSeconds, RateGqlDto draftAcceptance) {}
