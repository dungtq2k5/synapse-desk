package com.synapsedesk.gateway.web;

import com.synapsedesk.gateway.auth.CurrentRequest;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * What the client literally sent, as a tree, for the one question a bound DTO cannot
 * answer: was this key left out, or sent as {@code null}?
 *
 * <p>Both leave the DTO property {@code null} (the generated DTOs have no tri-state:
 * {@code openApiNullable} is off project-wide, deliberately). Several fields mean
 * different things in the two cases, and the difference is the contract: {@code dob}
 * left out is "leave it", {@code dob: null} is "clear it". The body is already cached
 * for every route that carries one ({@link JsonBodyFilter}), so this reads that copy
 * and never the stream.
 *
 * <p>For a field that is merely optional, with null meaning absent, none of this is
 * needed: {@code ExplicitNullJsonCustomizer} makes the DTO read it that way. Reach for
 * this only where a literal {@code null} has a meaning of its own.
 */
@Component
public class RawJsonBody {

  private final ObjectMapper json;

  public RawJsonBody(ObjectMapper json) {
    this.json = json;
  }

  /** The request's JSON body, or an empty object when none was cached. */
  public JsonNode current() {
    if (CurrentRequest.request() instanceof CachedBodyRequest cached) {
      return json.readTree(cached.body());
    }

    return json.readTree("{}");
  }

  /** Whether the client sent {@code field} at all, with any value (including null). */
  public boolean has(String field) {
    return current().has(field);
  }

  /** Whether the client sent {@code field} as a literal {@code null}, and not left it out. */
  public boolean isNull(String field) {
    JsonNode value = current().get(field);

    return value != null && value.isNull();
  }
}
