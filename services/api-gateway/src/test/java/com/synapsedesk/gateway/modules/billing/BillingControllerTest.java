package com.synapsedesk.gateway.modules.billing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.synapsedesk.gateway.common.auth.CurrentUser;
import com.synapsedesk.gateway.common.auth.RequestContext;
import com.synapsedesk.gateway.model.ChangePlanDto;
import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.server.ResponseStatusException;
import synapsedesk.auth.Billing.PlanChangePreviewResponse;
import synapsedesk.auth.Billing.PlanChangeResponse;
import synapsedesk.auth.BillingServiceGrpc;
import synapsedesk.ingestion.Document.StorageUsageResponse;
import synapsedesk.ingestion.DocumentServiceGrpc;

/**
 * `BillingApi` — specifically {@code changePlan}'s usage-fit gate, ported
 * from {@code PlanChangeGuard.verify}. The property under test is that this
 * gate fails CLOSED: an unreadable usage leg is a 503 refusal, never an
 * allow with that dimension unchecked — the opposite of
 * {@code OrganizationsController.storageLeg}'s fail-open degrade, which is
 * deliberate since that one composes a REPORT and this one guards a WRITE.
 */
class BillingControllerTest {

  private final BillingServiceGrpc.BillingServiceBlockingStub stub = mock(
    BillingServiceGrpc.BillingServiceBlockingStub.class
  );
  private final DocumentServiceGrpc.DocumentServiceBlockingStub documentStub =
    mock(DocumentServiceGrpc.DocumentServiceBlockingStub.class);
  private final CurrentUser currentUser = mock(CurrentUser.class);
  private BillingController controller;

  private static ChangePlanDto dto() {
    return new ChangePlanDto(UUID.randomUUID(), "price_123");
  }

  @BeforeEach
  void setUp() {
    when(stub.withDeadlineAfter(anyLong(), any())).thenReturn(stub);
    when(stub.withInterceptors(any())).thenReturn(stub);
    when(documentStub.withDeadlineAfter(anyLong(), any())).thenReturn(
      documentStub
    );
    when(documentStub.withInterceptors(any())).thenReturn(documentStub);
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
    RequestContextHolder.setRequestAttributes(
      new ServletRequestAttributes(mock(HttpServletRequest.class))
    );
    controller = new BillingController(stub, documentStub, currentUser);
  }

  @AfterEach
  void tearDown() {
    RequestContextHolder.resetRequestAttributes();
  }

  @Test
  void anUnreadableUsageLegRefusesRatherThanAllows() {
    when(stub.previewPlanChange(any())).thenReturn(
      PlanChangePreviewResponse.newBuilder()
        .addNarrowedDimensions("storage")
        .setTargetMaxStorageBytes(1_000)
        .build()
    );
    when(documentStub.getStorageUsage(any())).thenThrow(
      new StatusRuntimeException(Status.UNAVAILABLE)
    );

    assertThatThrownBy(() ->
      controller.billingControllerChangePlanV1("key-1", dto())
    )
      .isInstanceOf(ResponseStatusException.class)
      .hasMessageContaining("503");

    verify(stub, org.mockito.Mockito.never()).changePlan(any());
  }

  @Test
  void aWideningChangeDialsIngestionForNothing() {
    when(stub.previewPlanChange(any())).thenReturn(
      PlanChangePreviewResponse.getDefaultInstance()
    );
    when(stub.changePlan(any())).thenReturn(
      PlanChangeResponse.getDefaultInstance()
    );

    controller.billingControllerChangePlanV1("key-1", dto());

    verifyNoInteractions(documentStub);
    verify(stub).changePlan(any());
  }

  @Test
  void usageOverTheTargetGrantRefusesBeforeStripeIsTouched() {
    when(stub.previewPlanChange(any())).thenReturn(
      PlanChangePreviewResponse.newBuilder()
        .addNarrowedDimensions("storage")
        .setTargetMaxStorageBytes(1_000)
        .build()
    );
    when(documentStub.getStorageUsage(any())).thenReturn(
      StorageUsageResponse.newBuilder().setUsedBytes(2_000).build()
    );

    assertThatThrownBy(() ->
      controller.billingControllerChangePlanV1("key-1", dto())
    )
      .isInstanceOf(ResponseStatusException.class)
      .hasMessageContaining("400");

    verify(stub, org.mockito.Mockito.never()).changePlan(any());
  }

  @Test
  void anOverLimitSeatCountRefusesWithoutDialingIngestionAtAll() {
    when(stub.previewPlanChange(any())).thenReturn(
      PlanChangePreviewResponse.newBuilder()
        .addOverLimit("maxAgentSeats: 12 in use, plan grants 10")
        .build()
    );

    assertThatThrownBy(() ->
      controller.billingControllerChangePlanV1("key-1", dto())
    )
      .isInstanceOf(ResponseStatusException.class)
      .hasMessageContaining("400");

    verifyNoInteractions(documentStub);
    verify(stub, org.mockito.Mockito.never()).changePlan(any());
  }
}
