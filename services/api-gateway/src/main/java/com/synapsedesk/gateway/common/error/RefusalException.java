package com.synapsedesk.gateway.common.error;

import java.util.Map;
import org.springframework.http.HttpStatusCode;
import org.springframework.web.server.ResponseStatusException;

/**
 * A refusal with data the error envelope carries as `details`: the over-limit
 * items on a plan that doesn't fit, the organization's status on a lifecycle
 * refusal. A client acts on the data, never on the sentence.
 *
 * <p>Still a {@link ResponseStatusException}, so everything that reads one
 * (the GraphQL error codes among them) sees the status and reason as before.
 */
public class RefusalException extends ResponseStatusException {

  private final transient Map<String, Object> details;

  public RefusalException(
    HttpStatusCode status,
    String reason,
    Map<String, Object> details
  ) {
    super(status, reason);
    this.details = Map.copyOf(details);
  }

  /** What the envelope carries as `details`. */
  public Map<String, Object> details() {
    return details;
  }
}
