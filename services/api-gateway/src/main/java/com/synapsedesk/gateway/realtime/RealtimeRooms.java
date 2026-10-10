package com.synapsedesk.gateway.realtime;

/**
 * `packages/contracts/src/contracts/realtime.contract.ts`'s five room-name helpers,
 * reproduced byte-for-byte. A renamed room here is a client that stops
 * receiving, silently — the same failure class as a renamed socket event.
 */
public final class RealtimeRooms {

  private RealtimeRooms() {}

  public static String userRoom(String userId) {
    return "user:" + userId;
  }

  public static String orgRoom(String organizationId) {
    return "org:" + organizationId;
  }

  public static String ticketRoom(String ticketId) {
    return "ticket:" + ticketId;
  }

  /** Not a separate top-level namespace — the same `ticket:<id>` room, `:internal` suffixed. */
  public static String ticketInternalRoom(String ticketId) {
    return "ticket:" + ticketId + ":internal";
  }

  public static String deptRoom(String departmentId) {
    return "dept:" + departmentId;
  }
}
