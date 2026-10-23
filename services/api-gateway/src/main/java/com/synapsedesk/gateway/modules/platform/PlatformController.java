package com.synapsedesk.gateway.modules.platform;

import com.synapsedesk.gateway.common.auth.CurrentRequest;
import com.synapsedesk.gateway.common.auth.CurrentUser;
import com.synapsedesk.gateway.common.auth.RequestContext;
import com.synapsedesk.gateway.common.lifecycle.OrgAccess;
import com.synapsedesk.gateway.common.lifecycle.OrgAccessKind;
import com.synapsedesk.gateway.common.openapi.ApiErrors;
import com.synapsedesk.gateway.common.security.SuperAdminOnly;
import com.synapsedesk.gateway.common.validation.Matches;
import com.synapsedesk.gateway.common.web.ApiPaths;
import com.synapsedesk.gateway.common.web.ApiResponse;
import com.synapsedesk.gateway.common.web.PagedData;
import com.synapsedesk.gateway.common.web.SortDirection;
import com.synapsedesk.gateway.modules.organizations.dto.rest.OffboardResponseDto;
import com.synapsedesk.gateway.modules.platform.dto.rest.ApplyPlanResponseDto;
import com.synapsedesk.gateway.modules.platform.dto.rest.AssignPlanDto;
import com.synapsedesk.gateway.modules.platform.dto.rest.BillingEventsResponseDto;
import com.synapsedesk.gateway.modules.platform.dto.rest.CreateGlobalRoleDto;
import com.synapsedesk.gateway.modules.platform.dto.rest.CreatePlanDto;
import com.synapsedesk.gateway.modules.platform.dto.rest.CreatePlatformOrganizationDto;
import com.synapsedesk.gateway.modules.platform.dto.rest.CreatePlatformOrganizationResponseDto;
import com.synapsedesk.gateway.modules.platform.dto.rest.DeletePlanResponseDto;
import com.synapsedesk.gateway.modules.platform.dto.rest.FinanceSnapshotResponseDto;
import com.synapsedesk.gateway.modules.platform.dto.rest.OffboardOrganizationDto;
import com.synapsedesk.gateway.modules.platform.dto.rest.OrganizationSortField;
import com.synapsedesk.gateway.modules.platform.dto.rest.OrganizationStatusFilter;
import com.synapsedesk.gateway.modules.platform.dto.rest.PlanSortField;
import com.synapsedesk.gateway.modules.platform.dto.rest.PlatformMetricsResponseDto;
import com.synapsedesk.gateway.modules.platform.dto.rest.PlatformOrganizationDetailResponseDto;
import com.synapsedesk.gateway.modules.platform.dto.rest.PlatformOrganizationResponseDto;
import com.synapsedesk.gateway.modules.platform.dto.rest.PlatformOrganizationStatusResponseDto;
import com.synapsedesk.gateway.modules.platform.dto.rest.PlatformUserResponseDto;
import com.synapsedesk.gateway.modules.platform.dto.rest.ReleasePlanDto;
import com.synapsedesk.gateway.modules.platform.dto.rest.ResetBillingCycleDto;
import com.synapsedesk.gateway.modules.platform.dto.rest.SetOrganizationStatusDto;
import com.synapsedesk.gateway.modules.platform.dto.rest.SubscriptionPlanResponseDto;
import com.synapsedesk.gateway.modules.platform.dto.rest.UpdatePlanDto;
import com.synapsedesk.gateway.modules.platform.dto.rest.UpdatePlatformOrganizationDto;
import com.synapsedesk.gateway.modules.roles.dto.rest.RoleResponseDto;
import com.synapsedesk.gateway.modules.users.dto.rest.UserSortField;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.util.UUID;
import org.jspecify.annotations.Nullable;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * `PlatformApi` — the routed assembly of all 20 Super Admin operations,
 * delegating to the three services this interface was ported across:
 * {@link PlatformOrganizationsService} (organizations CRUD/lifecycle, 8
 * ops), {@link PlatformUsersRolesFinanceService} (cross-tenant users,
 * global roles, metrics, finance, 6 ops), and {@link PlatformPlansService}
 * (the plan catalogue, 6 ops). The hand-declared {@code @RequestMapping}s
 * live here, and only here, because Spring registers a route on the bean
 * whose method carries the annotation — the three services above carried
 * real, sabotage-tested logic with no route attached until this class
 * existed.
 *
 * <p><b>Migrated off `PlatformApi`.</b> {@code createOrganization},
 * {@code createPlan}, {@code createGlobalRole} answer 201; {@code offboard}
 * is a DELETE that still reads a body, matching the generated interface
 * exactly rather than "fixing" it — that is a flip decision for its own
 * pass, not something to decide inside this migration.
 */
@Tag(name = "Platform")
@RestController
// Refused to anyone but a super admin, before the body is read (SessionInterceptor, from this marker). A super admin has no tenant, so the lifecycle gate never decides here either: the route is exempt outright.
@SuperAdminOnly
@OrgAccessKind(OrgAccess.AUTH)
@RequestMapping(ApiPaths.V1)
@Validated
public class PlatformController {

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

  @GetMapping(
    value = "/platform/organizations",
    produces = { "application/json" }
  )
  @ApiErrors({ "401" })
  public ResponseEntity<
    ApiResponse<PagedData<PlatformOrganizationResponseDto>>
  > platformControllerListOrganizationsV1(
    @DecimalMin(value = "1") @Valid @RequestParam(
      value = "page",
      required = false,
      defaultValue = "1"
    ) BigDecimal page,
    @DecimalMin(value = "1") @DecimalMax(value = "100") @Valid @RequestParam(
      value = "limit",
      required = false,
      defaultValue = "10"
    ) BigDecimal limit,
    @Valid @RequestParam(
      value = "sortOrder",
      required = false,
      defaultValue = "ASC"
    ) SortDirection sortOrder,
    @Valid @RequestParam(
      value = "searchTerm",
      required = false
    ) @Nullable String searchTerm,
    @Valid @RequestParam(
      value = "sortBy",
      required = false,
      defaultValue = "createdAt"
    ) OrganizationSortField sortBy,
    @Valid @RequestParam(
      value = "includeDeleted",
      required = false,
      defaultValue = "false"
    ) Boolean includeDeleted,
    @Valid @RequestParam(
      value = "status",
      required = false
    ) @Nullable OrganizationStatusFilter statusFilter
  ) {
    String status = statusFilter == null ? null : statusFilter.name();
    return organizations.listOrganizations(
      context(),
      page,
      limit,
      sortOrder.name(),
      searchTerm,
      sortBy.name(),
      includeDeleted,
      status
    );
  }

  @PostMapping(
    value = "/platform/organizations",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors(
    value = { "400", "401", "409" },
    descriptions = @ApiErrors.Description(
      status = "409",
      value = "The address (`slug`) or the domain is already taken; the sentence says which."
    )
  )
  @ResponseStatus(HttpStatus.CREATED)
  public ResponseEntity<
    ApiResponse<CreatePlatformOrganizationResponseDto>
  > platformControllerCreateOrganizationV1(
    @Valid @RequestBody CreatePlatformOrganizationDto createPlatformOrganizationDto
  ) {
    return organizations.createOrganization(
      context(),
      createPlatformOrganizationDto
    );
  }

  @GetMapping(
    value = "/platform/organizations/{id}",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "404" })
  public ResponseEntity<
    ApiResponse<PlatformOrganizationDetailResponseDto>
  > platformControllerGetOrganizationV1(@PathVariable("id") String id) {
    return organizations.getOrganization(context(), id);
  }

  @PatchMapping(
    value = "/platform/organizations/{id}",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "404" })
  public ResponseEntity<
    ApiResponse<PlatformOrganizationResponseDto>
  > platformControllerUpdateOrganizationV1(
    @PathVariable("id") String id,
    @Valid @RequestBody UpdatePlatformOrganizationDto updatePlatformOrganizationDto
  ) {
    return organizations.updateOrganization(
      context(),
      id,
      updatePlatformOrganizationDto
    );
  }

  @PostMapping(
    value = "/platform/organizations/{id}/status",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "404" })
  public ResponseEntity<
    ApiResponse<PlatformOrganizationStatusResponseDto>
  > platformControllerSetStatusV1(
    @PathVariable("id") String id,
    @Valid @RequestBody SetOrganizationStatusDto setOrganizationStatusDto
  ) {
    return organizations.setStatus(context(), id, setOrganizationStatusDto);
  }

  @PostMapping(
    value = "/platform/organizations/{id}/billing-cycle/reset",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "404" })
  public ResponseEntity<
    ApiResponse<PlatformOrganizationResponseDto>
  > platformControllerResetBillingCycleV1(
    @PathVariable("id") String id,
    @Valid @RequestBody ResetBillingCycleDto resetBillingCycleDto
  ) {
    return organizations.resetBillingCycle(context(), id, resetBillingCycleDto);
  }

  @DeleteMapping(
    value = "/platform/organizations/{id}",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "404" })
  public ResponseEntity<
    ApiResponse<OffboardResponseDto>
  > platformControllerOffboardV1(
    @PathVariable("id") String id,
    @Valid @RequestBody OffboardOrganizationDto offboardOrganizationDto
  ) {
    return organizations.offboard(context(), id, offboardOrganizationDto);
  }

  @PostMapping(
    value = "/platform/organizations/{id}/restore",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "404" })
  public ResponseEntity<
    ApiResponse<PlatformOrganizationResponseDto>
  > platformControllerRestoreV1(@PathVariable("id") String id) {
    return organizations.restore(context(), id);
  }

  /**
   * Puts an organization on a negotiated plan (no Stripe product, not Free),
   * or previews it with `?dryRun=true`. Answered in apply's shape, one
   * subscriber; over a limit still goes through.
   */
  @PostMapping(
    value = "/platform/organizations/{id}/plan",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors(
    value = { "400", "401", "404", "409" },
    descriptions = {
      @ApiErrors.Description(
        status = "400",
        value = "The plan is sold through Stripe, or is Free, or the request is malformed."
      ),
      @ApiErrors.Description(
        status = "409",
        value = "The organization has a Stripe subscription; cancel it first."
      ),
    }
  )
  public ResponseEntity<
    ApiResponse<ApplyPlanResponseDto>
  > platformControllerAssignPlanV1(
    @PathVariable("id") String id,
    @Valid @RequestParam(
      value = "dryRun",
      required = false,
      defaultValue = "false"
    ) Boolean dryRun,
    @Valid @RequestBody AssignPlanDto assignPlanDto
  ) {
    return plans.assignPlan(context(), id, assignPlanDto, dryRun);
  }

  /**
   * Releases an assigned organization to self-service: no plan, the free
   * tier's grants. `?dryRun=true` previews it. A pin is left as it is.
   */
  @DeleteMapping(
    value = "/platform/organizations/{id}/plan",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors(
    value = { "400", "401", "404", "409" },
    descriptions = @ApiErrors.Description(
      status = "409",
      value = "It isn’t on an assigned plan, or it has a Stripe subscription; the sentence says which."
    )
  )
  public ResponseEntity<
    ApiResponse<ApplyPlanResponseDto>
  > platformControllerReleasePlanV1(
    @PathVariable("id") String id,
    @Valid @RequestParam(
      value = "dryRun",
      required = false,
      defaultValue = "false"
    ) Boolean dryRun,
    @Valid @RequestBody ReleasePlanDto releasePlanDto
  ) {
    return plans.releasePlan(context(), id, releasePlanDto, dryRun);
  }

  @GetMapping(value = "/platform/users", produces = { "application/json" })
  @ApiErrors({ "401" })
  public ResponseEntity<
    ApiResponse<PagedData<PlatformUserResponseDto>>
  > platformControllerListUsersV1(
    @DecimalMin(value = "1") @Valid @RequestParam(
      value = "page",
      required = false,
      defaultValue = "1"
    ) BigDecimal page,
    @DecimalMin(value = "1") @DecimalMax(value = "100") @Valid @RequestParam(
      value = "limit",
      required = false,
      defaultValue = "10"
    ) BigDecimal limit,
    @Valid @RequestParam(
      value = "sortOrder",
      required = false,
      defaultValue = "ASC"
    ) SortDirection sortOrder,
    @Valid @RequestParam(
      value = "searchTerm",
      required = false
    ) @Nullable String searchTerm,
    @Valid @RequestParam(
      value = "sortBy",
      required = false,
      defaultValue = "createdAt"
    ) UserSortField sortBy,
    @Valid @RequestParam(
      value = "includeDeleted",
      required = false,
      defaultValue = "false"
    ) Boolean includeDeleted,
    @Valid @RequestParam(
      value = "organizationId",
      required = false
    ) @Nullable UUID organizationId
  ) {
    return usersRolesFinance.listUsers(
      context(),
      page,
      limit,
      sortOrder.name(),
      searchTerm,
      sortBy.name(),
      includeDeleted,
      organizationId
    );
  }

  @GetMapping(value = "/platform/roles", produces = { "application/json" })
  @ApiErrors({ "401" })
  public ResponseEntity<
    ApiResponse<PagedData<RoleResponseDto>>
  > platformControllerListGlobalRolesV1(
    @DecimalMin(value = "1") @Valid @RequestParam(
      value = "page",
      required = false,
      defaultValue = "1"
    ) BigDecimal page,
    @DecimalMin(value = "1") @DecimalMax(value = "100") @Valid @RequestParam(
      value = "limit",
      required = false,
      defaultValue = "10"
    ) BigDecimal limit,
    @Valid @RequestParam(
      value = "sortOrder",
      required = false,
      defaultValue = "ASC"
    ) SortDirection sortOrder,
    @Valid @RequestParam(
      value = "searchTerm",
      required = false
    ) @Nullable String searchTerm,
    @Valid @RequestParam(
      value = "sortBy",
      required = false,
      defaultValue = "createdAt"
    ) UserSortField sortBy,
    @Valid @RequestParam(
      value = "includeDeleted",
      required = false,
      defaultValue = "false"
    ) Boolean includeDeleted,
    @Valid @RequestParam(
      value = "organizationId",
      required = false
    ) @Nullable UUID organizationId
  ) {
    return usersRolesFinance.listGlobalRoles(
      context(),
      page,
      limit,
      sortOrder.name(),
      searchTerm,
      sortBy.name(),
      includeDeleted,
      organizationId
    );
  }

  @PostMapping(
    value = "/platform/roles",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401" })
  @ResponseStatus(HttpStatus.CREATED)
  public ResponseEntity<
    ApiResponse<RoleResponseDto>
  > platformControllerCreateGlobalRoleV1(
    @Valid @RequestBody CreateGlobalRoleDto createGlobalRoleDto
  ) {
    return usersRolesFinance.createGlobalRole(context(), createGlobalRoleDto);
  }

  @GetMapping(value = "/platform/metrics", produces = { "application/json" })
  @ApiErrors({ "401" })
  public ResponseEntity<
    ApiResponse<PlatformMetricsResponseDto>
  > platformControllerGetMetricsV1() {
    return usersRolesFinance.getMetrics(context());
  }

  @GetMapping(value = "/platform/finance", produces = { "application/json" })
  @ApiErrors({ "401" })
  public ResponseEntity<
    ApiResponse<FinanceSnapshotResponseDto>
  > platformControllerGetFinanceSnapshotV1() {
    return usersRolesFinance.getFinanceSnapshot(context());
  }

  @GetMapping(
    value = "/platform/finance/events",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401" })
  public ResponseEntity<
    ApiResponse<BillingEventsResponseDto>
  > platformControllerListBillingEventsV1(
    @NotNull @Matches(regex = "^\\d{4}-\\d{2}-\\d{2}$") @Valid @RequestParam(
      value = "from",
      required = true
    ) String from,
    @NotNull @Matches(regex = "^\\d{4}-\\d{2}-\\d{2}$") @Valid @RequestParam(
      value = "to",
      required = true
    ) String to
  ) {
    return usersRolesFinance.listBillingEvents(context(), from, to);
  }

  @GetMapping(value = "/platform/plans", produces = { "application/json" })
  @ApiErrors({ "401" })
  public ResponseEntity<
    ApiResponse<PagedData<SubscriptionPlanResponseDto>>
  > platformControllerListPlansV1(
    @DecimalMin(value = "1") @Valid @RequestParam(
      value = "page",
      required = false,
      defaultValue = "1"
    ) BigDecimal page,
    @DecimalMin(value = "1") @DecimalMax(value = "100") @Valid @RequestParam(
      value = "limit",
      required = false,
      defaultValue = "10"
    ) BigDecimal limit,
    @Valid @RequestParam(
      value = "sortOrder",
      required = false,
      defaultValue = "ASC"
    ) SortDirection sortOrder,
    @Valid @RequestParam(
      value = "searchTerm",
      required = false
    ) @Nullable String searchTerm,
    @Valid @RequestParam(
      value = "sortBy",
      required = false,
      defaultValue = "createdAt"
    ) PlanSortField sortBy,
    @Valid @RequestParam(
      value = "includeInactive",
      required = false,
      defaultValue = "false"
    ) Boolean includeInactive,
    @Valid @RequestParam(
      value = "includeDeleted",
      required = false,
      defaultValue = "false"
    ) Boolean includeDeleted
  ) {
    return plans.listPlans(
      context(),
      page,
      limit,
      sortOrder.name(),
      searchTerm,
      sortBy.name(),
      includeInactive,
      includeDeleted
    );
  }

  @PostMapping(
    value = "/platform/plans",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors(
    value = { "400", "401", "503" },
    descriptions = {
      @ApiErrors.Description(
        status = "400",
        value = "The body is invalid, or Stripe has no such price, or the price has no single amount."
      ),
      @ApiErrors.Description(
        status = "503",
        value = "Stripe couldn't be reached to read the prices' amounts. Nothing was created; try again shortly."
      ),
    }
  )
  @ResponseStatus(HttpStatus.CREATED)
  public ResponseEntity<
    ApiResponse<SubscriptionPlanResponseDto>
  > platformControllerCreatePlanV1(
    @Valid @RequestBody CreatePlanDto createPlanDto
  ) {
    return plans.createPlan(context(), createPlanDto);
  }

  @GetMapping(value = "/platform/plans/{id}", produces = { "application/json" })
  @ApiErrors({ "400", "401", "404" })
  public ResponseEntity<
    ApiResponse<SubscriptionPlanResponseDto>
  > platformControllerGetPlanV1(@PathVariable("id") String id) {
    return plans.getPlan(context(), id);
  }

  @PatchMapping(
    value = "/platform/plans/{id}",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "404" })
  public ResponseEntity<
    ApiResponse<SubscriptionPlanResponseDto>
  > platformControllerUpdatePlanV1(
    @PathVariable("id") String id,
    @Valid @RequestBody UpdatePlanDto updatePlanDto
  ) {
    return plans.updatePlan(context(), id, updatePlanDto);
  }

  @DeleteMapping(
    value = "/platform/plans/{id}",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "404", "409" })
  public ResponseEntity<
    ApiResponse<DeletePlanResponseDto>
  > platformControllerDeletePlanV1(@PathVariable("id") String id) {
    return plans.deletePlan(context(), id);
  }

  @PostMapping(
    value = "/platform/plans/{id}/apply",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "404" })
  public ResponseEntity<
    ApiResponse<ApplyPlanResponseDto>
  > platformControllerApplyPlanV1(
    @PathVariable("id") String id,
    @Valid @RequestParam(
      value = "dryRun",
      required = false,
      defaultValue = "false"
    ) Boolean dryRun
  ) {
    return plans.applyPlan(context(), id, dryRun);
  }
}
