package com.synapsedesk.gateway.common.grpc;

import com.google.protobuf.ProtocolMessageEnum;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/**
 * An enum field the peer always fills, mapped to its domain value. The zero value, or
 * a member this gateway doesn't know, is the peer's bug: answered 502, naming the field
 * and what came, and logged, never mapped to {@code null}. A value that slipped past
 * the peer's write validation fails in the peer, which logs the string it stored.
 *
 * <p>{@code TicketResponseDto.StatusEnum.fromValue(...)} answers {@code null} for
 * anything it can't name, so the call wraps it:
 *
 * <pre>{@code
 * .status(RequiredEnum.required("status", ticket.getStatus(), StatusEnum.fromValue(...)))
 * }</pre>
 */
public final class RequiredEnum {

  private static final Logger LOG = LoggerFactory.getLogger(RequiredEnum.class);

  private RequiredEnum() {}

  /**
   * {@code mapped}, or a 502 naming {@code field} and the {@code wire} value it came
   * from.
   */
  public static <T> T required(String field, Object wire, T mapped) {
    if (mapped != null) return mapped;

    String message =
      "A service sent " +
      describe(wire) +
      " for " +
      field +
      ", which always has a value";
    LOG.error(message);
    throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, message);
  }

  /** The wire value as it crossed: an enum's number, a string quoted. */
  private static String describe(Object wire) {
    if (wire == null) return "nothing";
    if (wire instanceof String text) return "\"" + text + "\"";
    if (wire instanceof ProtocolMessageEnum member) {
      try {
        return String.valueOf(member.getNumber());
      } catch (IllegalArgumentException unrecognized) {
        return "a member this build doesn't know";
      }
    }
    return String.valueOf(wire);
  }
}
