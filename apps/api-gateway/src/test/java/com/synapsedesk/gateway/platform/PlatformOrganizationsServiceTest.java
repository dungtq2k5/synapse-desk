package com.synapsedesk.gateway.platform;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.auth.SuperAdminCheck;
import com.synapsedesk.gateway.lifecycle.OrganizationStatusService;
import com.synapsedesk.gateway.model.CreatePlatformOrganizationDto;
import com.synapsedesk.gateway.model.UpdatePlatformOrganizationDto;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.web.server.ResponseStatusException;
import synapsedesk.auth.Common.Gender;
import synapsedesk.auth.Common.OrgStatus;
import synapsedesk.auth.Organization.OrganizationResponse;
import synapsedesk.auth.Platform.CreatePlatformOrganizationRequest;
import synapsedesk.auth.Platform.CreatePlatformOrganizationResponse;
import synapsedesk.auth.Platform.PlatformOrganizationResponse;
import synapsedesk.auth.Platform.UpdatePlatformOrganizationRequest;
import synapsedesk.auth.PlatformServiceGrpc;

/**
 * `PlatformApi`'s organizations group (group 1 of 3). Sharpest properties:
 * {@link SuperAdminCheck} runs before the peer is ever dialed (same order
 * discipline as every handler-body guard in this gateway), and the two
 * hand-written validations (`slug`'s pattern, `allowedEmailDomains`' bound)
 * actually refuse — the generated DTOs carry neither, so nothing else in
 * the stack catches a regression here.
 */
class PlatformOrganizationsServiceTest {

  private final PlatformServiceGrpc.PlatformServiceBlockingStub stub = mock(
    PlatformServiceGrpc.PlatformServiceBlockingStub.class
  );
  private final SuperAdminCheck superAdminCheck = mock(SuperAdminCheck.class);
  private final OrganizationStatusService statuses = mock(
    OrganizationStatusService.class
  );
  private PlatformOrganizationsService service;

  private static RequestContext context() {
    return new RequestContext(
      "agent-1",
      null,
      true,
      List.of(),
      List.of(),
      true,
      "127.0.0.1",
      "test"
    );
  }

  @BeforeEach
  void setUp() {
    when(stub.withDeadlineAfter(anyLong(), any())).thenReturn(stub);
    when(stub.withInterceptors(any())).thenReturn(stub);
    service = new PlatformOrganizationsService(stub, superAdminCheck, statuses);
  }

  @Test
  void getOrganizationRefusesBeforeTouchingThePeerWhenTheCheckFails() {
    org.mockito.Mockito.doThrow(
      new ResponseStatusException(org.springframework.http.HttpStatus.FORBIDDEN)
    )
      .when(superAdminCheck)
      .require(any());

    assertThatThrownBy(() ->
      service.getOrganization(context(), "org-1")
    ).isInstanceOf(ResponseStatusException.class);

    verify(superAdminCheck).require(any());
    verifyNoMoreInteractions(stub);
  }

  @Test
  void aSlugIsLowercasedAndTrimmedBeforeThePatternRuns() {
    when(stub.createOrganization(any())).thenReturn(
      CreatePlatformOrganizationResponse.newBuilder()
        .setOrganization(
          PlatformOrganizationResponse.newBuilder().setOrganization(
            wireOrganization("org-1")
          )
        )
        .setAdmin(wireAdmin())
        .build()
    );

    CreatePlatformOrganizationDto dto = new CreatePlatformOrganizationDto();
    dto.setName("Acme");
    dto.setSlug(" ACME-CORP ");
    dto.setAdminEmail("admin@acme.test");
    dto.setAdminFullName("Admin Person");

    service.createOrganization(context(), dto);

    ArgumentCaptor<CreatePlatformOrganizationRequest> captor =
      ArgumentCaptor.forClass(CreatePlatformOrganizationRequest.class);
    verify(stub).createOrganization(captor.capture());
    assertThat(captor.getValue().getSlug()).isEqualTo("acme-corp");
  }

  @Test
  void aSlugWithADisallowedCharacterIsRefused() {
    CreatePlatformOrganizationDto dto = new CreatePlatformOrganizationDto();
    dto.setName("Acme");
    dto.setSlug("acme/corp");
    dto.setAdminEmail("admin@acme.test");
    dto.setAdminFullName("Admin Person");

    assertThatThrownBy(() ->
      service.createOrganization(context(), dto)
    ).isInstanceOf(ResponseStatusException.class);
  }

  @Test
  void moreThanFiftyAllowedEmailDomainsIsRefused() {
    CreatePlatformOrganizationDto dto = new CreatePlatformOrganizationDto();
    dto.setName("Acme");
    dto.setSlug("acme");
    dto.setAdminEmail("admin@acme.test");
    dto.setAdminFullName("Admin Person");
    List<String> domains = new ArrayList<>();
    for (int i = 0; i < 51; i++) {
      domains.add("d" + i + ".test");
    }
    dto.setAllowedEmailDomains(domains);

    assertThatThrownBy(() ->
      service.createOrganization(context(), dto)
    ).isInstanceOf(ResponseStatusException.class);
  }

  @Test
  void anAbsentQuotaFieldIsNeverSentAsZero() {
    when(stub.updateOrganization(any())).thenReturn(
      PlatformOrganizationResponse.newBuilder()
        .setOrganization(wireOrganization("org-1"))
        .build()
    );

    UpdatePlatformOrganizationDto dto = new UpdatePlatformOrganizationDto();
    dto.setName("Renamed");

    service.updateOrganization(context(), "org-1", dto);

    ArgumentCaptor<UpdatePlatformOrganizationRequest> captor =
      ArgumentCaptor.forClass(UpdatePlatformOrganizationRequest.class);
    verify(stub).updateOrganization(captor.capture());
    assertThat(captor.getValue().hasMaxAgentSeats()).isFalse();
    assertThat(captor.getValue().hasMaxStorageBytes()).isFalse();
    assertThat(captor.getValue().hasMonthlyAiTokenBudget()).isFalse();
  }

  @Test
  void anUnrecognizedStatusValueIsRefused() {
    // The `status` query param is generated as a plain String (unlike the
    // SetOrganizationStatusDto body field, which IS a Bean-Validated enum),
    // so this mapping is the only thing refusing an unrecognized literal.
    assertThatThrownBy(() ->
      service.listOrganizations(
        context(),
        java.math.BigDecimal.ONE,
        java.math.BigDecimal.TEN,
        "ASC",
        null,
        "createdAt",
        false,
        "NOT_A_REAL_STATUS"
      )
    ).isInstanceOf(ResponseStatusException.class);
  }

  private static OrganizationResponse wireOrganization(String id) {
    com.google.protobuf.Timestamp now =
      com.google.protobuf.Timestamp.newBuilder()
        .setSeconds(1_756_684_800)
        .build();
    return OrganizationResponse.newBuilder()
      .setId(id)
      .setName("Acme")
      .setSlug("acme")
      .setStatus(OrgStatus.ORG_STATUS_ACTIVE)
      .setEnforceTwoFactor(false)
      .setMaxAgentSeats(5)
      .setMaxStorageBytes(1000)
      .setMonthlyAiTokenBudget(1000)
      .setBillingCycleStart(now)
      .setCreatedAt(now)
      .setUpdatedAt(now)
      .build();
  }

  private static synapsedesk.auth.Common.UserResponse wireAdmin() {
    com.google.protobuf.Timestamp now =
      com.google.protobuf.Timestamp.newBuilder()
        .setSeconds(1_756_684_800)
        .build();
    return synapsedesk.auth.Common.UserResponse.newBuilder()
      .setId("11111111-1111-4111-8111-111111111111")
      .setFullName("Admin Person")
      .setEmail("admin@acme.test")
      .setIsEmailVerified(false)
      .setIsPhoneVerified(false)
      .setGender(Gender.GENDER_UNSPECIFIED)
      .setIsLocked(false)
      .setIsTwoFactorEnabled(false)
      .setCreatedAt(now)
      .setUpdatedAt(now)
      .build();
  }

  // A freeze that waited out the cached decision would be the wrong direction for the
  // one action an operator takes when something is going wrong right now.

  private static PlatformOrganizationResponse reply() {
    return PlatformOrganizationResponse.newBuilder()
      .setOrganization(wireOrganization("org-9"))
      .build();
  }

  @Test
  void updatingAnOrganizationDropsItsCachedStatus() {
    when(stub.updateOrganization(any())).thenReturn(reply());

    service.updateOrganization(
      context(),
      "org-9",
      new com.synapsedesk.gateway.model.UpdatePlatformOrganizationDto()
    );

    verify(statuses).invalidate("org-9");
  }

  @Test
  void settingAStatusDropsItsCachedStatus() {
    when(stub.setOrganizationStatus(any())).thenReturn(reply());
    var dto = new com.synapsedesk.gateway.model.SetOrganizationStatusDto();
    dto.setStatus(
      com.synapsedesk.gateway.model.SetOrganizationStatusDto.StatusEnum.FROZEN
    );
    dto.setReason("suspected fraud");

    service.setStatus(context(), "org-9", dto);

    verify(statuses).invalidate("org-9");
  }

  @Test
  void offboardingDropsItsCachedStatus() {
    when(stub.offboardOrganization(any())).thenReturn(
      synapsedesk.auth.Platform.OffboardOrganizationResponse.getDefaultInstance()
    );

    var dto = new com.synapsedesk.gateway.model.OffboardOrganizationDto();
    dto.setReason("contract ended");

    service.offboard(context(), "org-9", dto);

    verify(statuses).invalidate("org-9");
  }

  @Test
  void restoringDropsItsCachedStatus() {
    when(stub.restoreOrganization(any())).thenReturn(reply());

    service.restore(context(), "org-9");

    verify(statuses).invalidate("org-9");
  }

  @Test
  void aMutationThatFailedDropsNothingBecauseNothingChanged() {
    when(stub.setOrganizationStatus(any())).thenThrow(
      io.grpc.Status.FAILED_PRECONDITION.asRuntimeException()
    );
    var dto = new com.synapsedesk.gateway.model.SetOrganizationStatusDto();
    dto.setStatus(
      com.synapsedesk.gateway.model.SetOrganizationStatusDto.StatusEnum.FROZEN
    );
    dto.setReason("suspected fraud");

    assertThatThrownBy(() ->
      service.setStatus(context(), "org-9", dto)
    ).isInstanceOf(io.grpc.StatusRuntimeException.class);

    verify(statuses, org.mockito.Mockito.never()).invalidate(any());
  }
}
