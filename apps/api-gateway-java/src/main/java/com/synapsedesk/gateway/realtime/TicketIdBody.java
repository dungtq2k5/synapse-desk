package com.synapsedesk.gateway.realtime;

/** The body shape every ticket-addressed client frame carries: one id. */
public record TicketIdBody(String ticketId) {}
