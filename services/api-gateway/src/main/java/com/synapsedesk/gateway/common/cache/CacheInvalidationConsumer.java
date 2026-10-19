package com.synapsedesk.gateway.common.cache;

import com.synapsedesk.gateway.common.config.StoreProperties;
import com.synapsedesk.gateway.common.contracts.Subjects;
import com.synapsedesk.gateway.common.lifecycle.OrganizationStatusService;
import com.synapsedesk.gateway.common.nats.NatsEnvelope;
import com.synapsedesk.gateway.common.runtime.RuntimeParticipant;
import io.nats.client.Connection;
import io.nats.client.Dispatcher;
import io.nats.client.Message;
import io.nats.client.Nats;
import java.io.IOException;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeoutException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

/**
 * Evicts cached scopes when a domain event says they are stale — the
 * gateway's first domain-event consumer, and the four decisions every later
 * one inherits.
 *
 * <p><b>1. The client: {@code io.nats:jnats} directly</b>, the same reasoning
 * as the gRPC stubs being blocking — one concurrency model.
 *
 * <p><b>2. No queue group</b>, so every replica receives every event. For
 * EVICTION that is correct: dropping a
 * scope twice is idempotent, and each replica holding its own subscription
 * is what makes its own read-through re-warm correctly. A queue group would
 * mean only one replica evicts, leaving every other replica serving a stale
 * entry it can no longer un-cache.
 *
 * <p><b>Measured, not merely asserted: this specific property is
 * unobservable from outside a single-replica test.</b> A queue group was
 * added by hand and every row in
 * {@code test/gateway-contract/cache-invalidation.contract-spec.ts}
 * still passed — because eviction drops a SHARED Redis key, one consumer
 * instance evicting it looks identical, from any external read, to every
 * replica's own consumer having done so. The decision is still correct (it
 * is what a later realtime consumer needs, where delivery is to a
 * per-replica held socket and genuinely is observable —
 * `realtime.contract-spec.ts`'s existing frame-count rows already prove that
 * shape), but no row here can prove a queue group wrong, and none claims to.
 *
 * <p><b>3. The subscription lives between {@link #activate} and
 * {@link #deactivate}.</b> {@link #activate} opens the connection and
 * subscribes; {@link #deactivate} closes it. {@code RuntimeParticipants} calls
 * them at boot and shutdown, and retries the first while NATS is unreachable.
 *
 * <p><b>4. The envelope.</b> A Nest {@code ClientProxy.emit(pattern, event)}
 * — what every publisher here actually calls — puts the message on the wire
 * as {@code {"pattern": "<subject>", "data": <event>}}; Nest's own
 * deserializer unwraps it for `.data` on the OTHER end. A jnats subscriber
 * receives the RAW bytes with no such unwrapping, so this consumer performs
 * the same check by hand: a top-level {@code pattern} OR {@code data} key
 * means the payload is that envelope and the real event is `.data`; anything
 * else is the event itself, unwrapped — the rule
 * `packages/nest-common/src/configs/nats.config.ts` documents, on the reading side.
 */
@Component
@Order(0)
public class CacheInvalidationConsumer implements RuntimeParticipant {

  private static final Logger LOG = LoggerFactory.getLogger(
    CacheInvalidationConsumer.class
  );

  private static final String SCOPE_TICKETS = "tickets";
  private static final String SCOPE_DOCUMENTS = "documents";
  private static final String SCOPE_SETTINGS = "settings";
  private static final String SCOPE_ORGANIZATIONS = "organizations";

  /**
   * Subject to scopes dropped. {@code document.uploaded} is deliberately
   * ABSENT — it is the worker's trigger, nothing is readable yet, and the
   * list's 60s TTL covers the window. {@code billing.entitlements_changed}
   * is the one subject that drops two scopes, not one.
   */
  static final Map<String, List<String>> SUBJECT_SCOPES = buildSubjectScopes();

  private final StoreProperties store;
  private final CacheService cache;
  private final ObjectMapper json;
  private final OrganizationStatusService statuses;

  private volatile Connection connection;

  public CacheInvalidationConsumer(
    StoreProperties store,
    CacheService cache,
    ObjectMapper json,
    OrganizationStatusService statuses
  ) {
    this.store = store;
    this.cache = cache;
    this.json = json;
    this.statuses = statuses;
  }

  @Override
  public synchronized void activate() {
    try {
      Connection opened = Nats.connect(store.natsUrl());
      Dispatcher dispatcher = opened.createDispatcher(this::onMessage);
      for (String subject : SUBJECT_SCOPES.keySet()) {
        dispatcher.subscribe(subject);
      }
      // "activate() returned" must mean "subscribed": the SUBs are queued on
      // the connection, and core NATS drops an event published before the broker
      // has them. Flushing waits for the broker to have read them all.
      opened.flush(Duration.ofSeconds(5));
      connection = opened;
      LOG.info(
        "Cache invalidation consumer subscribed to {} subjects",
        SUBJECT_SCOPES.size()
      );
    } catch (InterruptedException failure) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException(
        "Could not start the cache invalidation consumer",
        failure
      );
    } catch (IOException | TimeoutException failure) {
      throw new IllegalStateException(
        "Could not start the cache invalidation consumer",
        failure
      );
    }
  }

  @Override
  public synchronized void deactivate() {
    Connection open = connection;
    connection = null;
    if (open == null) {
      return;
    }

    try {
      open.close();
    } catch (InterruptedException interrupted) {
      Thread.currentThread().interrupt();
    }
  }

  /**
   * One handler for every subscribed subject: the cache does not care WHICH
   * ticket pattern fired, only that the tenant's scope is now wrong.
   */
  void onMessage(Message message) {
    List<String> scopes = SUBJECT_SCOPES.get(message.getSubject());
    if (scopes == null) {
      return;
    }

    for (String scope : scopes) {
      drop(scope, message.getData());
    }

    // **And the lifecycle status.** Stripe's events move it (past due, frozen)
    // and the gateway only relays them, so no write here invalidates it: the
    // gate would let a past-due tenant write for the status cache's thirty
    // seconds. The same event that carries the new grants carries this.
    if (Subjects.BILLING_ENTITLEMENTS_CHANGED.equals(message.getSubject())) {
      String organizationId = organizationIdOf(message.getData());
      if (organizationId != null) {
        statuses.invalidate(organizationId);
      }
    }
  }

  /**
   * Drops a scope for the event's tenant. Never throws: a failed
   * invalidation costs one stale entry until its TTL, never a dead consumer.
   */
  private void drop(String scope, byte[] payload) {
    String organizationId = organizationIdOf(payload);

    if (organizationId == null) {
      // Not thrown: an event with no tenant is a producer-side bug, and the
      // right response is a log somebody can find — not a dead consumer.
      LOG.warn("Cache event for scope {} carried no tenant", scope);

      return;
    }

    try {
      int removed = cache.invalidateScope(organizationId, scope);
      if (removed > 0) {
        LOG.debug(
          "Dropped {} {} entries for {}",
          removed,
          scope,
          organizationId
        );
      }
    } catch (RuntimeException invalidationFailed) {
      LOG.error(
        "Cache invalidation failed for {}: {}",
        scope,
        invalidationFailed.getMessage()
      );
    }
  }

  /**
   * The tenant on a domain event, unwrapping the Nest envelope first if the
   * payload carries one. See the class docblock's item 4 — now
   * {@link NatsEnvelope}'s own logic, shared with the realtime consumers.
   */
  static String organizationIdOf(ObjectMapper json, byte[] payload) {
    return NatsEnvelope.organizationIdOf(NatsEnvelope.unwrap(json, payload));
  }

  private String organizationIdOf(byte[] payload) {
    return organizationIdOf(json, payload);
  }

  private static Map<String, List<String>> buildSubjectScopes() {
    Map<String, List<String>> map = new LinkedHashMap<>();

    for (String subject : List.of(
      Subjects.TICKET_CREATED,
      Subjects.TICKET_ESCALATED,
      Subjects.TICKET_ASSIGNED,
      Subjects.TICKET_REASSIGNED,
      Subjects.TICKET_UNASSIGNED,
      Subjects.TICKET_STATUS_CHANGED,
      Subjects.TICKET_MESSAGE_CREATED,
      Subjects.TICKET_MESSAGE_UPDATED,
      Subjects.TICKET_MESSAGE_REDACTED
    )) {
      map.put(subject, List.of(SCOPE_TICKETS));
    }

    // `document.uploaded` is deliberately absent — see the class docblock.
    for (String subject : List.of(
      Subjects.DOCUMENT_INDEXED,
      Subjects.DOCUMENT_INGESTION_FAILED,
      Subjects.DOCUMENT_SCOPE_CHANGED
    )) {
      map.put(subject, List.of(SCOPE_DOCUMENTS));
    }

    map.put(
      Subjects.BILLING_ENTITLEMENTS_CHANGED,
      List.of(SCOPE_SETTINGS, SCOPE_ORGANIZATIONS)
    );

    return Map.copyOf(map);
  }
}
