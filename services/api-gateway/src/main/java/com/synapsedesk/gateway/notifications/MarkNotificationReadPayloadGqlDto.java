package com.synapsedesk.gateway.notifications;

/** `MarkNotificationReadPayload` — the new badge total, not the row the client already has. */
public record MarkNotificationReadPayloadGqlDto(String id, int unreadCount) {}
