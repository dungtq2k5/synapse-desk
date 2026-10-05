package com.synapsedesk.gateway.lifecycle;

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
 * The cached tenant state: shared with Node under the same key, value and TTL, failing
 * closed, and degrading rather than failing when Redis is unavailable.
 */
class OrganizationStatusServiceTest {

  private static final String ORG = "99999999-9999-4999-8999-999999999999";
  private static final String KEY = "org-status:" + ORG;

  private OrganizationServiceBlockingStub peer;
  private StringRedisTemplate redis;
  private ValueOperations<String, String> values;
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
    service = new OrganizationStatusService(
      peer,
      redis,
      JsonMapper.builder().build()
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
  void aMissAsksThePeerForThisTenantAndCachesTheAnswerForThirtySecondsInNodesShape() {
    peerSays(OrgStatus.ORG_STATUS_SUSPENDED_PAST_DUE, false);

    assertThat(service.get(ORG)).isEqualTo(
      new OrganizationStatusService.State("SUSPENDED_PAST_DUE", false)
    );

    ArgumentCaptor<GetOrganizationStatusRequest> asked =
      ArgumentCaptor.forClass(GetOrganizationStatusRequest.class);
    verify(peer).getOrganizationStatus(asked.capture());
    assertThat(asked.getValue().getOrganizationId()).isEqualTo(ORG);
    // `status` then `deleted`, as Node writes it, for thirty seconds.
    verify(values).set(
      KEY,
      "{\"status\":\"SUSPENDED_PAST_DUE\",\"deleted\":false}",
      Duration.ofSeconds(30)
    );
  }

  @Test
  void aDeletedTenantIsCachedAsDeleted() {
    peerSays(OrgStatus.ORG_STATUS_ACTIVE, true);

    assertThat(service.get(ORG).deleted()).isTrue();

    verify(values).set(
      KEY,
      "{\"status\":\"ACTIVE\",\"deleted\":true}",
      Duration.ofSeconds(30)
    );
  }

  @Test
  void aStatusThePeerCouldNotReadIsFrozenAndCachedAsSuchBecauseUsableForAnUnknownTenantGatesNothing() {
    peerSays(OrgStatus.ORG_STATUS_UNSPECIFIED, false);

    assertThat(service.get(ORG).status()).isEqualTo("FROZEN");
    verify(values).set(
      eq(KEY),
      eq("{\"status\":\"FROZEN\",\"deleted\":false}"),
      any(Duration.class)
    );
  }

  @Test
  void everyKnownStatusIsSpelledAsNodeSpellsIt() {
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
  void aPeerThatCannotBeReachedFailsTheLookupAndCachesNothing() {
    when(peer.getOrganizationStatus(any())).thenThrow(
      Status.UNAVAILABLE.asRuntimeException()
    );

    assertThatThrownBy(() -> service.get(ORG)).isInstanceOf(
      io.grpc.StatusRuntimeException.class
    );

    verify(values, never()).set(any(), any(), any(Duration.class));
  }

  @Test
  void invalidatingDropsTheKeyAtOnce() {
    service.invalidate(ORG);

    verify(redis).delete(KEY);
  }

  @Test
  void aFailedInvalidationIsNotFatalBecauseTheEntryExpiresOnItsOwn() {
    when(redis.delete(KEY)).thenThrow(
      new IllegalStateException("redis is down")
    );

    service.invalidate(ORG);
  }
}
