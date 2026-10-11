package com.synapsedesk.gateway.tickets;

import com.synapsedesk.gateway.common.auth.CurrentRequest;
import com.synapsedesk.gateway.common.auth.CurrentUser;
import com.synapsedesk.gateway.common.auth.RequestContext;
import com.synapsedesk.gateway.common.graphql.UserSummaryGqlDto;
import java.util.concurrent.CompletableFuture;
import org.dataloader.DataLoader;
import org.springframework.graphql.data.method.annotation.SchemaMapping;
import org.springframework.stereotype.Controller;

/**
 * `TicketMessage.sender`. Caller-scoped like `notifications`: no `@RequirePermission`, but still
 * behind an authenticated caller, since the loader needs a tenant to scope
 * its batch RPC by.
 *
 * <p>The SAME loader `Ticket.assignee`/`Ticket.author` will use once those
 * resolvers wire them, so a thread where one agent wrote every message costs one
 * call.
 */
@Controller
public class TicketMessagesResolver {

  private final CurrentUser currentUser;

  public TicketMessagesResolver(CurrentUser currentUser) {
    this.currentUser = currentUser;
  }

  @SchemaMapping(typeName = "TicketMessage", field = "sender")
  public CompletableFuture<UserSummaryGqlDto> sender(
    TicketMessageGqlDto message,
    DataLoader<String, UserSummaryGqlDto> loader
  ) {
    if (message.senderId() == null) {
      // No user wrote this message — an AI-generated one — and no loader
      // call for it either: a null key would poison the batch for every
      // other row on the page.
      return CompletableFuture.completedFuture(null);
    }

    RequestContext context = currentUser.require(CurrentRequest.request());

    return loader.load(message.senderId(), context);
  }
}
