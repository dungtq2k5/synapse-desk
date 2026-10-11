package com.synapsedesk.gateway.realtime;

import com.corundumstudio.socketio.SocketIOClient;
import com.synapsedesk.gateway.common.auth.JwtPrincipal;
import com.synapsedesk.gateway.common.auth.RequestContext;
import com.synapsedesk.gateway.common.grpc.CallerMetadata;
import io.grpc.stub.MetadataUtils;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import synapsedesk.ticket.Common.TicketResponse;
import synapsedesk.ticket.Common.TicketStatus;
import synapsedesk.ticket.Ticket.GetTicketRequest;
import synapsedesk.ticket.TicketServiceGrpc;

/**
 * `TicketAccessService`, reproduced — the same answer `GET /tickets/:id`
 * gives, delegated here so there is one "may this person see this ticket?"
 * rather than an HTTP one and a WebSocket one that drift.
 *
 * <p><b>Fails CLOSED.</b> An unreachable ticket-service, a timeout, or a
 * malformed reply all mean "no" — a refusal here is routine (a stale room
 * join, a revoked grant), not an operational event, so it logs at DEBUG.
 */
@Component
public class TicketAccessService {

  private static final Logger LOG = LoggerFactory.getLogger(
    TicketAccessService.class
  );

  private static final long DEADLINE_SECONDS = 5;
  private static final String READ_ALL = "ticket.read.all";

  private final TicketServiceGrpc.TicketServiceBlockingStub stub;

  public TicketAccessService(TicketServiceGrpc.TicketServiceBlockingStub stub) {
    this.stub = stub;
  }

  /**
   * {@code ticket.read.all} still requires a successful, IN-TENANT
   * {@code getTicket} — the RPC's own tenant scoping from caller metadata
   * is what confirms existence, not a bypass of it. Otherwise: the AUTHOR
   * or the CURRENT assignee only — a past assignee is deliberately
   * excluded, a live-subscription concern, not a historical-read one.
   */
  public boolean canRead(
    String ticketId,
    JwtPrincipal principal,
    SocketIOClient client
  ) {
    try {
      TicketResponse ticket = withMetadata(principal, client).getTicket(
        GetTicketRequest.newBuilder().setId(ticketId).build()
      );

      if (hasReadAll(principal)) {
        return true;
      }

      return isAuthorOrCurrentAssignee(ticket, principal);
    } catch (RuntimeException failure) {
      LOG.debug(
        "Ticket read-access check failed for {}: {}",
        ticketId,
        failure.getMessage()
      );

      return false;
    }
  }

  /**
   * The author or the current assignee ONLY — {@code ticket.read.all} is
   * deliberately EXCLUDED here: reading everything is not a licence to
   * post as the organization. Also refuses on a closed ticket.
   */
  public boolean canWrite(
    String ticketId,
    JwtPrincipal principal,
    SocketIOClient client
  ) {
    try {
      TicketResponse ticket = withMetadata(principal, client).getTicket(
        GetTicketRequest.newBuilder().setId(ticketId).build()
      );

      if (ticket.getStatus() == TicketStatus.TICKET_STATUS_CLOSED) {
        return false;
      }

      return isAuthorOrCurrentAssignee(ticket, principal);
    } catch (RuntimeException failure) {
      LOG.debug(
        "Ticket write-access check failed for {}: {}",
        ticketId,
        failure.getMessage()
      );

      return false;
    }
  }

  private static boolean isAuthorOrCurrentAssignee(
    TicketResponse ticket,
    JwtPrincipal principal
  ) {
    if (ticket.getAuthorId().equals(principal.sub())) {
      return true;
    }

    return (
      ticket.hasCurrentAssigneeId() &&
      ticket.getCurrentAssigneeId().equals(principal.sub())
    );
  }

  private static boolean hasReadAll(JwtPrincipal principal) {
    return (
      principal.permissionCodes() != null &&
      principal.permissionCodes().contains(READ_ALL)
    );
  }

  private TicketServiceGrpc.TicketServiceBlockingStub withMetadata(
    JwtPrincipal principal,
    SocketIOClient client
  ) {
    RequestContext context = SocketRequestContext.from(principal, client);

    return stub
      .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
      .withInterceptors(
        MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context))
      );
  }
}
