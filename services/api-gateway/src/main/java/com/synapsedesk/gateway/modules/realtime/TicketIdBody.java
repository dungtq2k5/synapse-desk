package com.synapsedesk.gateway.modules.realtime;

/** The body shape every ticket-addressed client frame carries: one id. */
public record TicketIdBody(String ticketId) {}
