package com.synapsedesk.gateway.modules.clienterrors;

import com.synapsedesk.gateway.common.auth.CurrentRequest;
import com.synapsedesk.gateway.common.auth.CurrentUser;
import com.synapsedesk.gateway.common.auth.RequestContext;
import com.synapsedesk.gateway.common.lifecycle.OrgAccess;
import com.synapsedesk.gateway.common.lifecycle.OrgAccessKind;
import com.synapsedesk.gateway.common.metrics.GatewayMetrics;
import com.synapsedesk.gateway.common.openapi.ApiErrors;
import com.synapsedesk.gateway.common.openapi.RouteSecurity;
import com.synapsedesk.gateway.common.throttle.AuthThrottle;
import com.synapsedesk.gateway.common.throttle.RouteThrottle;
import com.synapsedesk.gateway.common.throttle.ThrottleByAddress;
import com.synapsedesk.gateway.common.throttle.ThrottleOverride;
import com.synapsedesk.gateway.common.throttle.ThrottlerTiers;
import com.synapsedesk.gateway.common.web.ApiPaths;
import com.synapsedesk.gateway.modules.clienterrors.dto.rest.ReportClientErrorDto;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.ObjectMapper;

/**
 * Browser errors, as one log line each: WARN, {@code "event":"client_error"}.
 *
 * <p>Accepted signed in or out (errors before sign-in matter); the user and
 * organization ids are added when a session is present. Nothing is stored, and
 * the line holds only the fields below: the path without its query or
 * fragment, never page text or form values. Rate-limited per address, and the
 * body is capped before it is read ({@link ClientErrorSizeFilter}).
 */
@Tag(name = "Client errors")
@RestController
@RequestMapping(ApiPaths.V1)
@OrgAccessKind(OrgAccess.AUTH)
@Validated
@AuthThrottle
public class ClientErrorsController {

  private static final Logger LOG = LoggerFactory.getLogger("ClientErrors");

  /** How much of {@code stack} the log line keeps. */
  static final int STACK_KEPT = 2000;

  private final CurrentUser currentUser;
  private final GatewayMetrics metrics;
  private final ObjectMapper json;

  public ClientErrorsController(
    CurrentUser currentUser,
    GatewayMetrics metrics,
    ObjectMapper json
  ) {
    this.currentUser = currentUser;
    this.metrics = metrics;
    this.json = json;
  }

  @PostMapping(value = "/client-errors", produces = { "application/json" })
  @ApiErrors({ "400" })
  @ResponseStatus(HttpStatus.NO_CONTENT)
  @RouteSecurity(RouteSecurity.Scheme.NONE)
  @ThrottleOverride(
    tier = ThrottlerTiers.AUTH,
    ttlMs = RouteThrottle.CLIENT_ERRORS_TTL_MS,
    limit = RouteThrottle.CLIENT_ERRORS_LIMIT
  )
  // By address only: a report before sign-in has no session to key on.
  @ThrottleByAddress
  public ResponseEntity<Void> clientErrorsControllerReportV1(
    @Valid @RequestBody ReportClientErrorDto report
  ) {
    HttpServletRequest request = CurrentRequest.request();
    Optional<RequestContext> caller = currentUser.read(request);
    String kind = report.getKind().getValue();

    metrics.clientError(kind);

    Map<String, Object> line = new LinkedHashMap<>();
    line.put("event", "client_error");
    line.put("kind", kind);
    line.put("message", report.getMessage());
    if (report.getStack() != null) {
      line.put("stack", truncate(report.getStack(), STACK_KEPT));
    }
    line.put("path", withoutQuery(report.getPath()));
    String userAgent = request.getHeader("User-Agent");
    if (userAgent != null) line.put("userAgent", truncate(userAgent, 300));
    if (report.getBuildId() != null) line.put("buildId", report.getBuildId());
    caller.ifPresent(context -> {
      line.put("userId", context.sub());
      if (context.organizationId() != null) {
        line.put("organizationId", context.organizationId());
      }
    });
    LOG.warn("{}", json.writeValueAsString(line));

    return ResponseEntity.status(HttpStatus.NO_CONTENT).build();
  }

  /** {@code /tickets/42?tab=notes#x} → {@code /tickets/42}. */
  static String withoutQuery(String path) {
    int cut = path.length();
    for (char mark : new char[] { '?', '#' }) {
      int at = path.indexOf(mark);
      if (at >= 0) cut = Math.min(cut, at);
    }
    return path.substring(0, cut);
  }

  private static String truncate(String value, int max) {
    return value.length() <= max ? value : value.substring(0, max);
  }
}
