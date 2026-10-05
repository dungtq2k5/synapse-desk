package com.synapsedesk.gateway.auth;

/** The caller's observed provenance — `{ ip, userAgent }`, unauthenticated or not. */
public record RequestOrigin(String ip, String userAgent) {}
