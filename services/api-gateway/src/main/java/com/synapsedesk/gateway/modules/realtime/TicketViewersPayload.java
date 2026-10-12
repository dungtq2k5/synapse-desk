package com.synapsedesk.gateway.modules.realtime;

import java.util.List;

/**
 * `ticket:viewers`' data: every agent viewing the ticket now, the receiver
 * included, as `TicketViewersPayload` in the contracts.
 */
public record TicketViewersPayload(String ticketId, List<Viewer> viewers) {
  /** One agent; {@code fullName} is null when it couldn't be resolved. */
  public record Viewer(String id, String fullName) {}
}
