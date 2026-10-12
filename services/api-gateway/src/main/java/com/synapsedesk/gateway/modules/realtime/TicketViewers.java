package com.synapsedesk.gateway.modules.realtime;

import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * The agents viewing each ticket, across every replica: one Redis sorted set
 * per ticket, {@code ticket-viewers:{ticketId}}, whose members are
 * {@code {userId}|{socketSessionId}} scored by the time the entry lapses.
 *
 * <p><b>A socket, not a user, is the entry.</b> An agent with the ticket open in
 * two tabs is one viewer until both have left, so {@link #viewerIds} answers
 * distinct user ids.
 *
 * <p><b>A dead replica's entries lapse.</b> Each replica re-scores its own
 * sockets every {@link #REFRESH} ({@link #refresh}), and a read drops every entry
 * past its score. A replica that dies stops re-scoring, so its sockets leave the
 * list within {@link #TTL}; the change is seen at the ticket's next join, leave or
 * disconnect, which is when a list is sent.
 *
 * @example {@code viewers.join("t1", session, "u1"); viewers.viewerIds("t1")}
 */
@Component
public class TicketViewers {

  static final Duration TTL = Duration.ofSeconds(90);
  /** Thirty seconds, a third of {@link #TTL}: two refreshes can miss. */
  static final String REFRESH = "PT30S";

  private final StringRedisTemplate redis;

  /** This replica's entries: socket session → (ticket id → user id). */
  private final Map<UUID, Map<String, String>> local =
    new ConcurrentHashMap<>();

  public TicketViewers(StringRedisTemplate redis) {
    this.redis = redis;
  }

  /** Records a socket viewing a ticket. */
  public void join(String ticketId, UUID session, String userId) {
    local
      .computeIfAbsent(session, ignored -> new ConcurrentHashMap<>())
      .put(ticketId, userId);
    record(ticketId, member(userId, session));
  }

  /** Forgets a socket's view of a ticket; {@code false} when it had none. */
  public boolean leave(String ticketId, UUID session) {
    Map<String, String> tickets = local.get(session);
    String userId = tickets == null ? null : tickets.remove(ticketId);
    if (userId == null) return false;
    redis.opsForZSet().remove(key(ticketId), member(userId, session));
    return true;
  }

  /** Forgets every view a closing socket held; answers the tickets it left. */
  public List<String> disconnect(UUID session) {
    Map<String, String> tickets = local.remove(session);
    if (tickets == null) return List.of();
    tickets.forEach((ticketId, userId) ->
      redis.opsForZSet().remove(key(ticketId), member(userId, session))
    );
    return new ArrayList<>(tickets.keySet());
  }

  /** The distinct agents viewing a ticket now, lapsed entries dropped first. */
  public List<String> viewerIds(String ticketId) {
    String key = key(ticketId);
    redis.opsForZSet().removeRangeByScore(key, 0, System.currentTimeMillis());
    Set<String> members = redis.opsForZSet().range(key, 0, -1);
    Set<String> ids = new LinkedHashSet<>();
    if (members != null) {
      for (String member : members) {
        ids.add(member.substring(0, member.indexOf('|')));
      }
    }
    return new ArrayList<>(ids);
  }

  /** Re-scores this replica's entries, so only a dead replica's lapse. */
  @Scheduled(fixedDelayString = REFRESH)
  public void refresh() {
    local.forEach((session, tickets) ->
      tickets.forEach((ticketId, userId) ->
        record(ticketId, member(userId, session))
      )
    );
  }

  private void record(String ticketId, String member) {
    String key = key(ticketId);
    redis
      .opsForZSet()
      .add(key, member, (double) System.currentTimeMillis() + TTL.toMillis());
    // The set itself goes once every entry has lapsed.
    redis.expire(key, TTL);
  }

  private static String key(String ticketId) {
    return "ticket-viewers:" + ticketId;
  }

  private static String member(String userId, UUID session) {
    return userId + "|" + session;
  }
}
