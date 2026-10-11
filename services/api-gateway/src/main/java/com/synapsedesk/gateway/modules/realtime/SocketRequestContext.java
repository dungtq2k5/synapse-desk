package com.synapsedesk.gateway.modules.realtime;

import com.corundumstudio.socketio.SocketIOClient;
import com.synapsedesk.gateway.common.auth.JwtPrincipal;
import com.synapsedesk.gateway.common.auth.RequestContext;
import java.util.List;

/**
 * A {@code RequestContext} built from a verified socket rather than an HTTP
 * request — `CurrentUser.toContext`'s own construction, reproduced for the
 * one input it never had: a {@link SocketIOClient}. Extracted on its second
 * use ({@link TicketAccessService}, {@link AiStreamService}).
 */
final class SocketRequestContext {

  private SocketRequestContext() {}

  static RequestContext from(JwtPrincipal principal, SocketIOClient client) {
    return new RequestContext(
      principal.sub() == null ? "" : principal.sub(),
      principal.organizationId(),
      principal.isSuperAdmin(),
      principal.departmentIds() == null ? List.of() : principal.departmentIds(),
      principal.permissionCodes() == null
        ? List.of()
        : principal.permissionCodes(),
      principal.isEmailVerified(),
      SocketHandshakes.ip(client),
      SocketHandshakes.userAgent(client)
    );
  }
}
