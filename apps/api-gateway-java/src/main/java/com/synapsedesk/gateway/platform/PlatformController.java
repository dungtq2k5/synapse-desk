package com.synapsedesk.gateway.platform;

import com.synapsedesk.gateway.auth.CurrentRequest;
import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.generated.api.PlatformApi;
import com.synapsedesk.gateway.generated.model.CreateGlobalRoleDto;
import com.synapsedesk.gateway.generated.model.CreatePlanDto;
import com.synapsedesk.gateway.generated.model.CreatePlatformOrganizationDto;
import com.synapsedesk.gateway.generated.model.OffboardOrganizationDto;
import com.synapsedesk.gateway.generated.model.OrganizationsControllerRequestOffboardV1200Response;
import com.synapsedesk.gateway.generated.model.PlatformControllerApplyPlanV1200Response;
import com.synapsedesk.gateway.generated.model.PlatformControllerCreateOrganizationV1201Response;
import com.synapsedesk.gateway.generated.model.PlatformControllerCreatePlanV1201Response;
import com.synapsedesk.gateway.generated.model.PlatformControllerDeletePlanV1200Response;
import com.synapsedesk.gateway.generated.model.PlatformControllerGetFinanceSnapshotV1200Response;
import com.synapsedesk.gateway.generated.model.PlatformControllerGetMetricsV1200Response;
import com.synapsedesk.gateway.generated.model.PlatformControllerGetOrganizationV1200Response;
import com.synapsedesk.gateway.generated.model.PlatformControllerListBillingEventsV1200Response;
import com.synapsedesk.gateway.generated.model.PlatformControllerListOrganizationsV1200Response;
import com.synapsedesk.gateway.generated.model.PlatformControllerListPlansV1200Response;
import com.synapsedesk.gateway.generated.model.PlatformControllerListUsersV1200Response;
import com.synapsedesk.gateway.generated.model.ResetBillingCycleDto;
import com.synapsedesk.gateway.generated.model.RolesControllerCreateV1201Response;
import com.synapsedesk.gateway.generated.model.RolesControllerListV1200Response;
import com.synapsedesk.gateway.generated.model.SetOrganizationStatusDto;
import com.synapsedesk.gateway.generated.model.UpdatePlanDto;
import com.synapsedesk.gateway.generated.model.UpdatePlatformOrganizationDto;
import java.math.BigDecimal;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

/**
 * `PlatformApi` — the routed assembly of all 20 Super Admin operations,
 * delegating to the three services this interface was ported across:
 * {@link PlatformOrganizationsService} (organizations CRUD/lifecycle, 8
 * ops), {@link PlatformUsersRolesFinanceService} (cross-tenant users,
 * global roles, metrics, finance, 6 ops), and {@link PlatformPlansService}
 * (the plan catalogue, 6 ops). {@code implements PlatformApi} lives here,
 * and only here, because a generated interface's 20 abstract methods all
 * need an implementation before Spring can register any route on it — the
 * three services above carried real, sabotage-tested logic with no route
 * attached until this class existed.
 */
@RestController
public class PlatformController implements PlatformApi {

  private final CurrentUser currentUser;
  private final PlatformOrganizationsService organizations;
  private final PlatformUsersRolesFinanceService usersRolesFinance;
  private final PlatformPlansService plans;

  public PlatformController(
    CurrentUser currentUser,
    PlatformOrganizationsService organizations,
    PlatformUsersRolesFinanceService usersRolesFinance,
    PlatformPlansService plans
  ) {
    this.currentUser = currentUser;
    this.organizations = organizations;
    this.usersRolesFinance = usersRolesFinance;
    this.plans = plans;
  }

  private RequestContext context() {
    return currentUser.require(CurrentRequest.request());
  }

  @Override
  public ResponseEntity<PlatformControllerListOrganizationsV1200Response> platformControllerListOrganizationsV1(
    BigDecimal page,
    BigDecimal limit,
    String sortOrder,
    String searchTerm,
    String sortBy,
    Boolean includeDeleted,
    String status
  ) {
    return organizations.listOrganizations(
      context(),
      page,
      limit,
      sortOrder,
      searchTerm,
      sortBy,
      includeDeleted,
      status
    );
  }

  @Override
  public ResponseEntity<PlatformControllerCreateOrganizationV1201Response> platformControllerCreateOrganizationV1(
    CreatePlatformOrganizationDto createPlatformOrganizationDto
  ) {
    return organizations.createOrganization(
      context(),
      createPlatformOrganizationDto
    );
  }

  @Override
  public ResponseEntity<PlatformControllerGetOrganizationV1200Response> platformControllerGetOrganizationV1(
    String id
  ) {
    return organizations.getOrganization(context(), id);
  }

  @Override
  public ResponseEntity<PlatformControllerGetOrganizationV1200Response> platformControllerUpdateOrganizationV1(
    String id,
    UpdatePlatformOrganizationDto updatePlatformOrganizationDto
  ) {
    return organizations.updateOrganization(
      context(),
      id,
      updatePlatformOrganizationDto
    );
  }

  @Override
  public ResponseEntity<PlatformControllerGetOrganizationV1200Response> platformControllerSetStatusV1(
    String id,
    SetOrganizationStatusDto setOrganizationStatusDto
  ) {
    return organizations.setStatus(context(), id, setOrganizationStatusDto);
  }

  @Override
  public ResponseEntity<PlatformControllerGetOrganizationV1200Response> platformControllerResetBillingCycleV1(
    String id,
    ResetBillingCycleDto resetBillingCycleDto
  ) {
    return organizations.resetBillingCycle(context(), id, resetBillingCycleDto);
  }

  @Override
  public ResponseEntity<OrganizationsControllerRequestOffboardV1200Response> platformControllerOffboardV1(
    String id,
    OffboardOrganizationDto offboardOrganizationDto
  ) {
    return organizations.offboard(context(), id, offboardOrganizationDto);
  }

  @Override
  public ResponseEntity<PlatformControllerGetOrganizationV1200Response> platformControllerRestoreV1(
    String id
  ) {
    return organizations.restore(context(), id);
  }

  @Override
  public ResponseEntity<PlatformControllerListUsersV1200Response> platformControllerListUsersV1(
    BigDecimal page,
    BigDecimal limit,
    String sortOrder,
    String searchTerm,
    String sortBy,
    Boolean includeDeleted,
    UUID organizationId
  ) {
    return usersRolesFinance.listUsers(
      context(),
      page,
      limit,
      sortOrder,
      searchTerm,
      sortBy,
      includeDeleted,
      organizationId
    );
  }

  @Override
  public ResponseEntity<RolesControllerListV1200Response> platformControllerListGlobalRolesV1(
    BigDecimal page,
    BigDecimal limit,
    String sortOrder,
    String searchTerm,
    String sortBy,
    Boolean includeDeleted,
    UUID organizationId
  ) {
    return usersRolesFinance.listGlobalRoles(
      context(),
      page,
      limit,
      sortOrder,
      searchTerm,
      sortBy,
      includeDeleted,
      organizationId
    );
  }

  @Override
  public ResponseEntity<RolesControllerCreateV1201Response> platformControllerCreateGlobalRoleV1(
    CreateGlobalRoleDto createGlobalRoleDto
  ) {
    return usersRolesFinance.createGlobalRole(context(), createGlobalRoleDto);
  }

  @Override
  public ResponseEntity<PlatformControllerGetMetricsV1200Response> platformControllerGetMetricsV1() {
    return usersRolesFinance.getMetrics(context());
  }

  @Override
  public ResponseEntity<PlatformControllerGetFinanceSnapshotV1200Response> platformControllerGetFinanceSnapshotV1() {
    return usersRolesFinance.getFinanceSnapshot(context());
  }

  @Override
  public ResponseEntity<PlatformControllerListBillingEventsV1200Response> platformControllerListBillingEventsV1(
    String from,
    String to
  ) {
    return usersRolesFinance.listBillingEvents(context(), from, to);
  }

  @Override
  public ResponseEntity<PlatformControllerListPlansV1200Response> platformControllerListPlansV1(
    BigDecimal page,
    BigDecimal limit,
    String sortOrder,
    String searchTerm,
    String sortBy,
    Boolean includeInactive,
    Boolean includeDeleted
  ) {
    return plans.listPlans(
      context(),
      page,
      limit,
      sortOrder,
      searchTerm,
      sortBy,
      includeInactive,
      includeDeleted
    );
  }

  @Override
  public ResponseEntity<PlatformControllerCreatePlanV1201Response> platformControllerCreatePlanV1(
    CreatePlanDto createPlanDto
  ) {
    return plans.createPlan(context(), createPlanDto);
  }

  @Override
  public ResponseEntity<PlatformControllerCreatePlanV1201Response> platformControllerGetPlanV1(
    String id
  ) {
    return plans.getPlan(context(), id);
  }

  @Override
  public ResponseEntity<PlatformControllerCreatePlanV1201Response> platformControllerUpdatePlanV1(
    String id,
    UpdatePlanDto updatePlanDto
  ) {
    return plans.updatePlan(context(), id, updatePlanDto);
  }

  @Override
  public ResponseEntity<PlatformControllerDeletePlanV1200Response> platformControllerDeletePlanV1(
    String id
  ) {
    return plans.deletePlan(context(), id);
  }

  @Override
  public ResponseEntity<PlatformControllerApplyPlanV1200Response> platformControllerApplyPlanV1(
    String id,
    Boolean dryRun
  ) {
    return plans.applyPlan(context(), id, dryRun);
  }
}
