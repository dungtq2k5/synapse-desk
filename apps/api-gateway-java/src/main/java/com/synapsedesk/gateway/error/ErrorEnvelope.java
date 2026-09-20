package com.synapsedesk.gateway.error;

import java.time.Instant;

/**
 * The error body, exactly as the P3 capture records it.
 *
 * <p>ONE envelope, and `error` is a single STRING — not an array, and not a
 * nested object. The capture is the spec:
 *
 * <pre>
 * {"success":false,"statusCode":404,"path":"/api/v1/x","timestamp":"…","error":"Cannot GET /api/v1/x!"}
 * </pre>
 *
 * <p>Field ORDER is part of it: a client reading the raw body sees the same
 * shape from either implementation. Records serialise in declaration order.
 *
 * @param success always false here; the success envelope is a different type
 * @param statusCode repeated in the body because clients read it there
 * @param path the request path, as received
 * @param timestamp ISO-8601, UTC
 * @param error one message, ending in a single `!`
 */
public record ErrorEnvelope(
    boolean success, int statusCode, String path, String timestamp, String error) {

  /** Builds the envelope for one failure. */
  public static ErrorEnvelope of(int statusCode, String path, String message) {
    return new ErrorEnvelope(false, statusCode, path, Instant.now().toString(), message);
  }
}
