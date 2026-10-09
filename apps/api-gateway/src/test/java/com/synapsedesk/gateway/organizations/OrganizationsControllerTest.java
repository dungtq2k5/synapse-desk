package com.synapsedesk.gateway.organizations;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.cache.CacheService;
import com.synapsedesk.gateway.config.InboundEmailProperties;
import com.synapsedesk.gateway.lifecycle.OrganizationStatusService;
import com.synapsedesk.gateway.model.DeleteOrganizationDto;
import com.synapsedesk.gateway.model.UpdateOrganizationSettingsDto;
import com.synapsedesk.gateway.security.RequirePermission;
import com.synapsedesk.gateway.web.CachedBodyRequest;
import com.synapsedesk.gateway.web.RawJsonBody;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.function.Supplier;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import synapsedesk.auth.Organization.CompleteOnboardingRequest;
import synapsedesk.auth.Organization.DeleteOrganizationRequest;
import synapsedesk.auth.Organization.DeleteOrganizationResponse;
import synapsedesk.auth.Organization.OrganizationResponse;
import synapsedesk.auth.Organization.OrganizationSettingsResponse;
import synapsedesk.auth.Organization.UpdateOrganizationSettingsRequest;
import synapsedesk.auth.OrganizationServiceGrpc;
import synapsedesk.ingestion.DocumentServiceGrpc;
import tools.jackson.databind.ObjectMapper;

/**
 * `OrganizationsApi` — specifically {@code updateSettings}'s three-state
 * override fields, since Jackson binds an absent JSON key and an explicit
 * {@code null} to the same {@code null} on the DTO. The property under test
 * is that the raw request body, not the bound DTO, decides between "leave
 * alone", "clear" and "set".
 */
class OrganizationsControllerTest {

  private final OrganizationServiceGrpc.OrganizationServiceBlockingStub stub =
    mock(OrganizationServiceGrpc.OrganizationServiceBlockingStub.class);
  private final DocumentServiceGrpc.DocumentServiceBlockingStub documentStub =
    mock(DocumentServiceGrpc.DocumentServiceBlockingStub.class);
  private final CurrentUser currentUser = mock(CurrentUser.class);
  private final CacheService cache = mock(CacheService.class);
  private final OrganizationStatusService statuses = mock(
    OrganizationStatusService.class
  );
  private final InboundEmailProperties inboundEmail =
    new InboundEmailProperties(
      "secret",
      "support.example.com",
      "sender",
      "whsec",
      "re_key",
      "https://api.resend.test"
    );
  private OrganizationsController controller;

  private static void requestWithBody(String json) {
    MockHttpServletRequest request = new MockHttpServletRequest();
    RequestContextHolder.setRequestAttributes(
      new ServletRequestAttributes(
        new CachedBodyRequest(request, json.getBytes(StandardCharsets.UTF_8))
      )
    );
  }

  @BeforeEach
  void setUp() {
    when(stub.withDeadlineAfter(anyLong(), any())).thenReturn(stub);
    when(stub.withInterceptors(any())).thenReturn(stub);
    when(currentUser.require(any())).thenReturn(
      new RequestContext(
        "agent-1",
        "org-1",
        false,
        List.of(),
        List.of("organization.update"),
        true,
        "127.0.0.1",
        "test"
      )
    );
    when(cache.wrap(any(), anyLong(), any(), any())).thenAnswer(invocation ->
      ((Supplier<?>) invocation.getArgument(3)).get()
    );
    controller = new OrganizationsController(
      stub,
      documentStub,
      currentUser,
      cache,
      inboundEmail,
      new RawJsonBody(new ObjectMapper()),
      statuses
    );
  }

  @AfterEach
  void tearDown() {
    RequestContextHolder.resetRequestAttributes();
  }

  @Test
  void anAbsentOverrideFieldLeavesTheWireRequestUntouched() {
    requestWithBody("{}");
    when(stub.updateOrganizationSettings(any())).thenReturn(
      OrganizationSettingsResponse.getDefaultInstance()
    );

    controller.organizationsControllerUpdateSettingsV1(
      new UpdateOrganizationSettingsDto()
    );

    org.mockito.ArgumentCaptor<UpdateOrganizationSettingsRequest> captor =
      org.mockito.ArgumentCaptor.forClass(
        UpdateOrganizationSettingsRequest.class
      );
    org.mockito.Mockito.verify(stub).updateOrganizationSettings(
      captor.capture()
    );
    assertThat(captor.getValue().hasMaxDocumentBytesOverride()).isFalse();
    assertThat(captor.getValue().getClearMaxDocumentBytesOverride()).isFalse();
    assertThat(captor.getValue().getReplaceAllowedEmailDomains()).isFalse();
  }

  @Test
  void anExplicitNullOverrideFieldClearsIt() {
    requestWithBody("{\"maxDocumentBytesOverride\": null}");
    UpdateOrganizationSettingsDto dto = new UpdateOrganizationSettingsDto();
    // Matches what Jackson actually binds for this body: `null` either way.
    dto.setMaxDocumentBytesOverride(null);
    when(stub.updateOrganizationSettings(any())).thenReturn(
      OrganizationSettingsResponse.getDefaultInstance()
    );

    controller.organizationsControllerUpdateSettingsV1(dto);

    org.mockito.ArgumentCaptor<UpdateOrganizationSettingsRequest> captor =
      org.mockito.ArgumentCaptor.forClass(
        UpdateOrganizationSettingsRequest.class
      );
    org.mockito.Mockito.verify(stub).updateOrganizationSettings(
      captor.capture()
    );
    assertThat(captor.getValue().getClearMaxDocumentBytesOverride()).isTrue();
    assertThat(captor.getValue().hasMaxDocumentBytesOverride()).isFalse();
  }

  @Test
  void aValueOverrideFieldSetsItAndDoesNotClear() {
    requestWithBody("{\"maxAttachmentsPerMessageOverride\": 5}");
    UpdateOrganizationSettingsDto dto = new UpdateOrganizationSettingsDto();
    dto.setMaxAttachmentsPerMessageOverride(java.math.BigDecimal.valueOf(5));
    when(stub.updateOrganizationSettings(any())).thenReturn(
      OrganizationSettingsResponse.getDefaultInstance()
    );

    controller.organizationsControllerUpdateSettingsV1(dto);

    org.mockito.ArgumentCaptor<UpdateOrganizationSettingsRequest> captor =
      org.mockito.ArgumentCaptor.forClass(
        UpdateOrganizationSettingsRequest.class
      );
    org.mockito.Mockito.verify(stub).updateOrganizationSettings(
      captor.capture()
    );
    assertThat(
      captor.getValue().getMaxAttachmentsPerMessageOverride()
    ).isEqualTo(5);
    assertThat(
      captor.getValue().getClearMaxAttachmentsPerMessageOverride()
    ).isFalse();
  }

  @Test
  void anAbsentAllowedEmailDomainsNeverReplaces() {
    requestWithBody("{\"enforceTwoFactor\": true}");
    UpdateOrganizationSettingsDto dto = new UpdateOrganizationSettingsDto();
    dto.setEnforceTwoFactor(true);
    when(stub.updateOrganizationSettings(any())).thenReturn(
      OrganizationSettingsResponse.getDefaultInstance()
    );

    controller.organizationsControllerUpdateSettingsV1(dto);

    org.mockito.ArgumentCaptor<UpdateOrganizationSettingsRequest> captor =
      org.mockito.ArgumentCaptor.forClass(
        UpdateOrganizationSettingsRequest.class
      );
    org.mockito.Mockito.verify(stub).updateOrganizationSettings(
      captor.capture()
    );
    assertThat(captor.getValue().getReplaceAllowedEmailDomains()).isFalse();
    assertThat(captor.getValue().getAllowedEmailDomainsList()).isEmpty();
  }

  @Test
  void anEmptyAllowedEmailDomainsArrayStillReplaces() {
    // The exact bug this raw-body check exists to prevent: an empty array
    // bound from JSON is indistinguishable from the DTO's own unset default
    // without checking the body for the key's presence.
    requestWithBody("{\"allowedEmailDomains\": []}");
    UpdateOrganizationSettingsDto dto = new UpdateOrganizationSettingsDto();
    dto.setAllowedEmailDomains(List.of());
    when(stub.updateOrganizationSettings(any())).thenReturn(
      OrganizationSettingsResponse.getDefaultInstance()
    );

    controller.organizationsControllerUpdateSettingsV1(dto);

    org.mockito.ArgumentCaptor<UpdateOrganizationSettingsRequest> captor =
      org.mockito.ArgumentCaptor.forClass(
        UpdateOrganizationSettingsRequest.class
      );
    org.mockito.Mockito.verify(stub).updateOrganizationSettings(
      captor.capture()
    );
    assertThat(captor.getValue().getReplaceAllowedEmailDomains()).isTrue();
  }

  @Test
  void getCarriesNoPermissionRequirement() throws NoSuchMethodException {
    // A choice, not an omission — the End User role holds zero
    // permission rows, so gating the app shell's own workspace read 403s the
    // first screen for every ordinary member.
    Method get = OrganizationsController.class.getMethod(
      "organizationsControllerGetV1"
    );
    assertThat(get.isAnnotationPresent(RequirePermission.class)).isFalse();
  }

  @Test
  void deletingTheOwnOrganizationDropsItsCachedStatusAfterAuthServiceFrozeIt() {
    when(
      stub.deleteOrganization(any(DeleteOrganizationRequest.class))
    ).thenReturn(DeleteOrganizationResponse.getDefaultInstance());
    requestWithBody("{\"reason\":\"closing\"}");

    controller.organizationsControllerRequestOffboardV1(
      new DeleteOrganizationDto().reason("closing")
    );

    verify(statuses).invalidate("org-1");
  }

  @Test
  void aDeleteAuthServiceRefusedLeavesTheCachedStatusAlone() {
    when(
      stub.deleteOrganization(any(DeleteOrganizationRequest.class))
    ).thenThrow(io.grpc.Status.PERMISSION_DENIED.asRuntimeException());
    requestWithBody("{\"reason\":\"closing\"}");

    org.assertj.core.api.Assertions.assertThatThrownBy(() ->
      controller.organizationsControllerRequestOffboardV1(
        new DeleteOrganizationDto().reason("closing")
      )
    );

    verify(statuses, never()).invalidate(any());
  }

  @Test
  void completingOnboardingDropsTheCachedStatus() {
    when(
      stub.completeOnboarding(any(CompleteOnboardingRequest.class))
    ).thenReturn(OrganizationResponse.getDefaultInstance());
    requestWithBody("{}");

    controller.organizationsControllerCompleteOnboardingV1();

    verify(statuses).invalidate("org-1");
  }
}
