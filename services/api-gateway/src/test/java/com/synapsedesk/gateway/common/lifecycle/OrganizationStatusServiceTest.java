package com.synapsedesk.gateway.common.lifecycle;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.synapsedesk.gateway.common.cache.CacheService;
import io.grpc.Status;
import java.time.Duration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import synapsedesk.auth.Common.OrgStatus;
import synapsedesk.auth.Organization.GetOrganizationStatusRequest;
import synapsedesk.auth.Organization.OrganizationStatusResponse;
import synapsedesk.auth.OrganizationServiceGrpc.OrganizationServiceBlockingStub;
import tools.jackson.databind.json.JsonMapper;

/**
 * The cached tenant state: shared by every replica under one key, value and TTL,
 * failing closed, degrading rather than failing when Redis is unavailable, and
 * riding out a peer outage on the last known status, never on no status.
 */
class OrganizationStatusServiceTest {

  private static final String ORG = "99999999-9999-4999-8999-999999999999";
  private static final String KEY = "org-status:" + ORG;

  private OrganizationServiceBlockingStub peer;
  private StringRedisTemplate redis;
  private ValueOperations<String, String> values;
  private CacheService cache;
  private OrganizationStatusService service;

  @SuppressWarnings("unchecked")
  @BeforeEach
  void setUp() {
    peer = mock(OrganizationServiceBlockingStub.class);
    when(peer.withDeadlineAfter(anyLong(), any())).thenReturn(peer);
    when(peer.withInterceptors(any())).thenReturn(peer);
    redis = mock(StringRedisTemplate.class);
    values = mock(ValueOperations.class);
    when(redis.opsForValue()).thenReturn(values);
    cache = mock(CacheService.class);
    service = new OrganizationStatusService(
      peer,
      redis,
      JsonMapper.builder().build(),
      cache
    );
  }

  private static final Duration KEPT = Duration.ofSeconds(30).plusMinutes(5);

  /** The one value written, after checking it is kept 30 s + 5 min. */
  private tools.jackson.databind.JsonNode written() {
    ArgumentCaptor<String> value = ArgumentCaptor.forClass(String.class);
    verify(values).set(eq(KEY), value.capture(), eq(KEPT));

    return JsonMapper.builder().build().readTree(value.getValue());
  }

  private void cached(String status, long freshUntil) {
    when(values.get(KEY)).thenReturn(
      "{\"status\":\"" +
        status +
        "\",\"deleted\":false,\"freshUntil\":" +
        freshUntil +
        "}"
    );
  }

  private void peerFails(Status status) {
    when(peer.getOrganizationStatus(any())).thenThrow(
      status.asRuntimeException()
    );
  }

  private void peerSays(OrgStatus status, boolean deleted) {
    when(peer.getOrganizationStatus(any())).thenReturn(
      OrganizationStatusResponse.newBuilder()
        .setStatus(status)
        .setDeleted(deleted)
        .build()
    );
  }

  @Test
  void aCachedDecisionIsUsedWithoutAskingThePeer() {
    when(values.get(KEY)).thenReturn(
      "{\"status\":\"FROZEN\",\"deleted\":false}"
    );

    assertThat(service.get(ORG)).isEqualTo(
      new OrganizationStatusService.State("FROZEN", false)
    );

    verify(peer, never()).getOrganizationStatus(any());
  }

  @Test
  void aMissAsksThePeerForThisTenantAndCachesTheAnswerFreshForThirtySeconds() {
    peerSays(OrgStatus.ORG_STATUS_SUSPENDED_PAST_DUE, false);
    long before = System.currentTimeMillis();

    assertThat(service.get(ORG)).isEqualTo(
      new OrganizationStatusService.State("SUSPENDED_PAST_DUE", false)
    );

    ArgumentCaptor<GetOrganizationStatusRequest> asked =
      ArgumentCaptor.forClass(GetOrganizationStatusRequest.class);
    verify(peer).getOrganizationStatus(asked.capture());
    assertThat(asked.getValue().getOrganizationId()).isEqualTo(ORG);
    var value = written();
    assertThat(value.get("status").asString()).isEqualTo("SUSPENDED_PAST_DUE");
    assertThat(value.get("deleted").asBoolean()).isFalse();
    assertThat(value.get("freshUntil").asLong()).isBetween(
      before + 30_000,
      System.currentTimeMillis() + 30_000
    );
  }

  @Test
  void aDeletedTenantIsCachedAsDeleted() {
    peerSays(OrgStatus.ORG_STATUS_ACTIVE, true);

    assertThat(service.get(ORG).deleted()).isTrue();

    assertThat(written().get("deleted").asBoolean()).isTrue();
  }

  @Test
  void aStatusThePeerCouldNotReadIsFrozenAndCachedAsSuchBecauseUsableForAnUnknownTenantGatesNothing() {
    peerSays(OrgStatus.ORG_STATUS_UNSPECIFIED, false);

    assertThat(service.get(ORG).status()).isEqualTo("FROZEN");
    assertThat(written().get("status").asString()).isEqualTo("FROZEN");
  }

  @Test
  void everyKnownStatusIsSpelledByItsProtoNameWithoutThePrefix() {
    assertThat(
      OrganizationStatusService.nameOf(OrgStatus.ORG_STATUS_ACTIVE)
    ).isEqualTo("ACTIVE");
    assertThat(
      OrganizationStatusService.nameOf(OrgStatus.ORG_STATUS_PENDING_ONBOARDING)
    ).isEqualTo("PENDING_ONBOARDING");
    assertThat(
      OrganizationStatusService.nameOf(OrgStatus.ORG_STATUS_SUSPENDED_PAST_DUE)
    ).isEqualTo("SUSPENDED_PAST_DUE");
    assertThat(
      OrganizationStatusService.nameOf(OrgStatus.ORG_STATUS_FROZEN)
    ).isEqualTo("FROZEN");
    assertThat(
      OrganizationStatusService.nameOf(OrgStatus.UNRECOGNIZED)
    ).isEqualTo("FROZEN");
  }

  @Test
  void aCachedValueThatCannotBeReadIsAMissNotAnError() {
    when(values.get(KEY)).thenReturn("not json at all");
    peerSays(OrgStatus.ORG_STATUS_ACTIVE, false);

    assertThat(service.get(ORG).status()).isEqualTo("ACTIVE");

    verify(peer).getOrganizationStatus(any());
  }

  @Test
  void aCachedValueMissingItsFieldsIsAMiss() {
    when(values.get(KEY)).thenReturn("{\"status\":\"FROZEN\"}");
    peerSays(OrgStatus.ORG_STATUS_ACTIVE, false);

    assertThat(service.get(ORG).status()).isEqualTo("ACTIVE");
  }

  @Test
  void aRedisThatCannotBeReadDegradesToAskingEveryTime() {
    when(values.get(KEY)).thenThrow(new IllegalStateException("redis is down"));
    peerSays(OrgStatus.ORG_STATUS_ACTIVE, false);

    assertThat(service.get(ORG).status()).isEqualTo("ACTIVE");
  }

  @Test
  void aRedisThatCannotBeWrittenCostsLatencyNotCorrectness() {
    peerSays(OrgStatus.ORG_STATUS_ACTIVE, false);
    doThrow(new IllegalStateException("redis is down"))
      .when(values)
      .set(any(), any(), any(Duration.class));

    assertThat(service.get(ORG).status()).isEqualTo("ACTIVE");
  }

  @Test
  void aPeerThatCannotBeReachedFailsTheLookupOfATenantWithNoEntryAndCachesNothing() {
    peerFails(Status.UNAVAILABLE);

    assertThatThrownBy(() -> service.get(ORG)).isInstanceOf(
      io.grpc.StatusRuntimeException.class
    );

    verify(values, never()).set(any(), any(), any(Duration.class));
  }

  // ------------------------------------------------------------ peer outage

  @Test
  void aFreshEntryIsUsedWithoutAskingThePeer() {
    cached("ACTIVE", System.currentTimeMillis() + 10_000);

    assertThat(service.get(ORG).status()).isEqualTo("ACTIVE");
    verify(peer, never()).getOrganizationStatus(any());
  }

  @Test
  void aStaleEntryIsRefreshedFromThePeerWhenItAnswers() {
    cached("ACTIVE", System.currentTimeMillis() - 1);
    peerSays(OrgStatus.ORG_STATUS_FROZEN, false);

    assertThat(service.get(ORG).status()).isEqualTo("FROZEN");
    assertThat(written().get("status").asString()).isEqualTo("FROZEN");
  }

  @Test
  void aStaleEntryAnswersWhileThePeerIsUnreachable() {
    for (Status down : new Status[] {
      Status.UNAVAILABLE,
      Status.DEADLINE_EXCEEDED,
    }) {
      setUp();
      cached("ACTIVE", System.currentTimeMillis() - 60_000);
      peerFails(down);

      assertThat(service.get(ORG).status())
        .as(down.getCode().name())
        .isEqualTo("ACTIVE");
      verify(values, never()).set(any(), any(), any(Duration.class));
    }
  }

  @Test
  void aStaleFreezeStillRefusesWhileThePeerIsUnreachable() {
    cached("FROZEN", System.currentTimeMillis() - 60_000);
    peerFails(Status.UNAVAILABLE);

    assertThat(service.get(ORG).status()).isEqualTo("FROZEN");
  }

  @Test
  void aStaleEntryDoesNotHideAnAnswerThatIsNotAnOutage() {
    cached("ACTIVE", System.currentTimeMillis() - 60_000);
    peerFails(Status.INTERNAL);

    assertThatThrownBy(() -> service.get(ORG)).isInstanceOf(
      io.grpc.StatusRuntimeException.class
    );
  }

  @Test
  void invalidatingDropsTheDecisionAndTheCachedOrganizationAtOnce() {
    service.invalidate(ORG);

    verify(redis).delete(KEY);
    verify(cache).invalidateScope(ORG, "organizations");
  }

  @Test
  void aFailedInvalidationIsNotFatalBecauseTheEntryExpiresOnItsOwn() {
    when(redis.delete(KEY)).thenThrow(
      new IllegalStateException("redis is down")
    );

    service.invalidate(ORG);
  }
}
