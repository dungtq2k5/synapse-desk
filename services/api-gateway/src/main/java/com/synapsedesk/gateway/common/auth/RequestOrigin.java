package com.synapsedesk.gateway.common.auth;

/** The caller's observed provenance — `{ ip, userAgent }`, unauthenticated or not. */
public record RequestOrigin(String ip, String userAgent) {}
