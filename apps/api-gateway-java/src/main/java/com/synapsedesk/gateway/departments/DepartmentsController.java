package com.synapsedesk.gateway.departments;

import com.synapsedesk.gateway.auth.CurrentRequest;
import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.auth.UserMapper;
import com.synapsedesk.gateway.cache.CacheService;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import com.synapsedesk.gateway.metrics.GuardRefusal;
import com.synapsedesk.gateway.model.AddDepartmentMembersDto;
import com.synapsedesk.gateway.model.AddDepartmentMembersResponseDto;
import com.synapsedesk.gateway.model.CreateDepartmentDto;
import com.synapsedesk.gateway.model.CurrentUserResponseDto.PermissionCodesEnum;
import com.synapsedesk.gateway.model.DepartmentMemberResponseDto;
import com.synapsedesk.gateway.model.DepartmentResponseDto;
import com.synapsedesk.gateway.model.UpdateDepartmentDto;
import com.synapsedesk.gateway.openapi.ApiErrors;
import com.synapsedesk.gateway.security.RequirePermission;
import com.synapsedesk.gateway.web.ApiPaths;
import com.synapsedesk.gateway.web.ApiResponse;
import com.synapsedesk.gateway.web.DepartmentMemberSortField;
import com.synapsedesk.gateway.web.DepartmentSortField;
import com.synapsedesk.gateway.web.PageMeta;
import com.synapsedesk.gateway.web.PagedData;
import com.synapsedesk.gateway.web.SortDirection;
import io.grpc.stub.MetadataUtils;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.TimeUnit;
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
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import synapsedesk.auth.Common.PageRequest;
import synapsedesk.auth.Common.SortOrder;
import synapsedesk.auth.Department.AddDepartmentMembersRequest;
import synapsedesk.auth.Department.CreateDepartmentRequest;
import synapsedesk.auth.Department.DepartmentIdRequest;
import synapsedesk.auth.Department.DepartmentMemberResponse;
import synapsedesk.auth.Department.DepartmentResponse;
import synapsedesk.auth.Department.GetDepartmentRequest;
import synapsedesk.auth.Department.ListDepartmentMembersRequest;
import synapsedesk.auth.Department.ListDepartmentMembersResponse;
import synapsedesk.auth.Department.ListDepartmentsRequest;
import synapsedesk.auth.Department.ListDepartmentsResponse;
import synapsedesk.auth.Department.RemoveDepartmentMemberRequest;
import synapsedesk.auth.Department.UpdateDepartmentRequest;
import synapsedesk.auth.DepartmentServiceGrpc;

/**
 * `DepartmentsApi` — against auth-service's `DepartmentService`
 * (`departments.controller.ts`, reproduced).
 *
 * <p>
 * <b>`?includeDeleted=true` needs `department.delete`, checked BEFORE the
 * cache lookup</b> — Node's own fix (`QueryPermissionGuard`, a real guard
 * rather than a handler check, because guards run before its `@Cacheable`
 * interceptor and a handler check would not). The Java shape is different —
 * there is no interceptor to run ahead of here, {@code list}'s own body IS
 * the cache lookup — but the ORDER is the property that matters: this reads
 * the RAW query parameter and refuses BEFORE {@code cache.buildKey}/
 * {@code cache.wrapTyped} ever run, so a caller without the permission can
 * never be served an entry a privileged caller's `?includeDeleted=true`
 * warmed.
 *
 * <p>
 * No write here evicts the cache — known gap 42, same as every other
 * `@Cacheable` route ported so far.
 *
 * <p><b>Migrated off `DepartmentsApi`.</b> `create` answers 201 —
 * {@code @ResponseStatus} is what tells springdoc that. `list`'s cache goes
 * through {@link CacheService#wrapTyped}, the same generic-safe path
 * `RolesController.list` established — a bare {@code Class<T>} would erase
 * `ApiResponse<PagedData<DepartmentResponseDto>>`'s own type arguments on a
 * cache HIT.
 */
@Tag(name = "Departments")
@RestController
@RequestMapping(ApiPaths.V1)
@Validated
public class DepartmentsController {

  private static final long DEADLINE_SECONDS = 5;
  private static final String CACHE_SCOPE = "departments";
  private static final long LIST_CACHE_TTL_SECONDS = 5 * 60;

  private final DepartmentServiceGrpc.DepartmentServiceBlockingStub stub;
  private final CurrentUser currentUser;
  private final CacheService cache;

  public DepartmentsController(
    DepartmentServiceGrpc.DepartmentServiceBlockingStub stub,
    CurrentUser currentUser,
    CacheService cache
  ) {
    this.stub = stub;
    this.currentUser = currentUser;
    this.cache = cache;
  }

  @GetMapping(value = "/departments", produces = { "application/json" })
  @ApiErrors({ "401", "403" })
  @RequirePermission(PermissionCodesEnum.DEPARTMENT_READ)
  public ResponseEntity<
    ApiResponse<PagedData<DepartmentResponseDto>>
  > departmentsControllerListV1(
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
    ) DepartmentSortField sortBy,
    @Valid @RequestParam(
      value = "includeDeleted",
      required = false,
      defaultValue = "false"
    ) Boolean includeDeleted
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    // `RequirePermissionForQuery`, ported: `includeDeleted` gates the whole
    // route's `@RequirePermission` OR-of semantics WIDER if added there, so
    // it is checked separately — and BEFORE the cache read below, or a
    // caller without `department.delete` could be served an entry a
    // privileged caller's request warmed.
    if (
      isRequested(CurrentRequest.request(), "includeDeleted") &&
      !context.isSuperAdmin() &&
      !context.permissionCodes().contains("department.delete")
    ) {
      throw GuardRefusal.refused(
        new ResponseStatusException(
          HttpStatus.FORBIDDEN,
          "Using 'includeDeleted' requires the department.delete permission"
        )
      );
    }

    Map<String, String> rawParams = new TreeMap<>();
    CurrentRequest.request()
      .getParameterMap()
      .forEach((name, values) -> {
        if (values.length > 0 && !values[0].isEmpty()) {
          rawParams.put(name, values[0]);
        }
      });

    String key = cache.buildKey(
      context.organizationId(),
      CACHE_SCOPE,
      rawParams
    );

    ApiResponse<PagedData<DepartmentResponseDto>> envelope = cache.wrapTyped(
      key,
      LIST_CACHE_TTL_SECONDS,
      new tools.jackson.core.type.TypeReference<
        ApiResponse<PagedData<DepartmentResponseDto>>
      >() {},
      () -> {
        PageRequest.Builder pageRequest = PageRequest.newBuilder()
          .setPage(page.intValue())
          .setLimit(limit.intValue())
          .setSortBy(sortBy.name())
          .setSortOrder(
            sortOrder == SortDirection.DESC
              ? SortOrder.SORT_ORDER_DESC
              : SortOrder.SORT_ORDER_ASC
          );
        if (searchTerm != null) {
          pageRequest.setSearchTerm(searchTerm);
        }

        ListDepartmentsResponse response = withMetadata(
          context
        ).listDepartments(
          ListDepartmentsRequest.newBuilder()
            .setPage(pageRequest)
            .setIncludeDeleted(Boolean.TRUE.equals(includeDeleted))
            .build()
        );

        PagedData<DepartmentResponseDto> data = new PagedData<>(
          response
            .getItemsList()
            .stream()
            .map(DepartmentsController::toDepartmentResponseDto)
            .toList(),
          PageMeta.from(response.getMeta())
        );

        return ApiResponse.of(200, "OK", data);
      }
    );

    return ResponseEntity.ok(envelope);
  }

  @GetMapping(value = "/departments/{id}", produces = { "application/json" })
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.DEPARTMENT_READ)
  public ResponseEntity<
    ApiResponse<DepartmentResponseDto>
  > departmentsControllerGetV1(@PathVariable("id") String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    DepartmentResponse response = withMetadata(context).getDepartment(
      GetDepartmentRequest.newBuilder().setId(id).build()
    );

    return okDepartment(response, "OK", 200);
  }

  @PostMapping(
    value = "/departments",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403" })
  @ResponseStatus(HttpStatus.CREATED)
  @RequirePermission(PermissionCodesEnum.DEPARTMENT_CREATE)
  public ResponseEntity<
    ApiResponse<DepartmentResponseDto>
  > departmentsControllerCreateV1(
    @Valid @RequestBody CreateDepartmentDto createDepartmentDto
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    CreateDepartmentRequest.Builder wire =
      CreateDepartmentRequest.newBuilder().setName(
        createDepartmentDto.getName()
      );
    if (createDepartmentDto.getDescription() != null) {
      wire.setDescription(createDepartmentDto.getDescription());
    }

    DepartmentResponse response = withMetadata(context).createDepartment(
      wire.build()
    );

    return okDepartment(response, "OK", 201);
  }

  @PatchMapping(
    value = "/departments/{id}",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.DEPARTMENT_UPDATE)
  public ResponseEntity<
    ApiResponse<DepartmentResponseDto>
  > departmentsControllerUpdateV1(
    @PathVariable("id") String id,
    @Valid @RequestBody UpdateDepartmentDto updateDepartmentDto
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    UpdateDepartmentRequest.Builder wire =
      UpdateDepartmentRequest.newBuilder().setId(id);
    if (updateDepartmentDto.getName() != null) {
      wire.setName(updateDepartmentDto.getName());
    }
    if (updateDepartmentDto.getDescription() != null) {
      wire.setDescription(updateDepartmentDto.getDescription());
    }

    DepartmentResponse response = withMetadata(context).updateDepartment(
      wire.build()
    );

    return okDepartment(response, "OK", 200);
  }

  @DeleteMapping(value = "/departments/{id}", produces = { "application/json" })
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.DEPARTMENT_DELETE)
  public ResponseEntity<ApiResponse<Void>> departmentsControllerRemoveV1(
    @PathVariable("id") String id
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    withMetadata(context).deleteDepartment(
      DepartmentIdRequest.newBuilder().setId(id).build()
    );

    return ResponseEntity.ok(ApiResponse.of(200, "Department deleted", null));
  }

  @PostMapping(
    value = "/departments/{id}/restore",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.DEPARTMENT_DELETE)
  public ResponseEntity<
    ApiResponse<DepartmentResponseDto>
  > departmentsControllerRestoreV1(@PathVariable("id") String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    DepartmentResponse response = withMetadata(context).restoreDepartment(
      DepartmentIdRequest.newBuilder().setId(id).build()
    );

    return okDepartment(response, "Department restored", 200);
  }

  @GetMapping(
    value = "/departments/{id}/members",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.DEPARTMENT_READ)
  public ResponseEntity<
    ApiResponse<PagedData<DepartmentMemberResponseDto>>
  > departmentsControllerListMembersV1(
    @PathVariable("id") String id,
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
      defaultValue = "assignedAt"
    ) DepartmentMemberSortField sortBy
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    PageRequest.Builder pageRequest = PageRequest.newBuilder()
      .setPage(page.intValue())
      .setLimit(limit.intValue())
      .setSortBy(sortBy.name())
      .setSortOrder(
        sortOrder == SortDirection.DESC
          ? SortOrder.SORT_ORDER_DESC
          : SortOrder.SORT_ORDER_ASC
      );
    if (searchTerm != null) {
      pageRequest.setSearchTerm(searchTerm);
    }

    ListDepartmentMembersResponse response = withMetadata(
      context
    ).listDepartmentMembers(
      ListDepartmentMembersRequest.newBuilder()
        .setDepartmentId(id)
        .setPage(pageRequest)
        .build()
    );

    PagedData<DepartmentMemberResponseDto> data = new PagedData<>(
      response
        .getItemsList()
        .stream()
        .map(DepartmentsController::toDepartmentMemberResponseDto)
        .toList(),
      PageMeta.from(response.getMeta())
    );

    return ResponseEntity.ok(ApiResponse.of(200, "OK", data));
  }

  @PostMapping(
    value = "/departments/{id}/members",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.DEPARTMENT_MEMBER_ASSIGN)
  public ResponseEntity<
    ApiResponse<AddDepartmentMembersResponseDto>
  > departmentsControllerAddMembersV1(
    @PathVariable("id") String id,
    @Valid @RequestBody AddDepartmentMembersDto addDepartmentMembersDto
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    AddDepartmentMembersRequest wire = AddDepartmentMembersRequest.newBuilder()
      .setDepartmentId(id)
      .addAllUserIds(
        addDepartmentMembersDto
          .getUserIds()
          .stream()
          .map(Object::toString)
          .toList()
      )
      .setIsPrimary(Boolean.TRUE.equals(addDepartmentMembersDto.getIsPrimary()))
      .build();

    var response = withMetadata(context).addDepartmentMembers(wire);

    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "Members assigned",
        new AddDepartmentMembersResponseDto(
          BigDecimal.valueOf(response.getAddedCount()),
          BigDecimal.valueOf(response.getUpdatedCount())
        )
      )
    );
  }

  @DeleteMapping(
    value = "/departments/{id}/members/{userId}",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.DEPARTMENT_MEMBER_ASSIGN)
  public ResponseEntity<ApiResponse<Void>> departmentsControllerRemoveMemberV1(
    @PathVariable("id") String id,
    @PathVariable("userId") String userId
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    withMetadata(context).removeDepartmentMember(
      RemoveDepartmentMemberRequest.newBuilder()
        .setDepartmentId(id)
        .setUserId(userId)
        .build()
    );

    return ResponseEntity.ok(ApiResponse.of(200, "Member removed", null));
  }

  /**
   * Whether the caller actually asked for the widening parameter — the raw
   * query string, not the bound/defaulted `Boolean includeDeleted` argument,
   * matching Node's own reasoning: `isRequested` reads before the framework
   * coerces `'true'` into a boolean, so keying off the typed argument would
   * treat every request as having asked (its default is `false`, itself a
   * valid string a client could have sent explicitly, but the RAW absence is
   * what Node's guard actually distinguishes).
   */
  private static boolean isRequested(
    jakarta.servlet.http.HttpServletRequest request,
    String name
  ) {
    String value = request.getParameter(name);
    if (value == null) {
      return false;
    }
    return !List.of("false", "0", "").contains(
      value.toLowerCase(java.util.Locale.ROOT)
    );
  }

  private static ResponseEntity<
    ApiResponse<DepartmentResponseDto>
  > okDepartment(DepartmentResponse response, String message, int status) {
    return ResponseEntity.status(status).body(
      ApiResponse.of(status, message, toDepartmentResponseDto(response))
    );
  }

  private static DepartmentResponseDto toDepartmentResponseDto(
    DepartmentResponse department
  ) {
    return new DepartmentResponseDto()
      .id(department.getId())
      .name(department.getName())
      .description(
        department.hasDescription() ? department.getDescription() : null
      )
      .memberCount(BigDecimal.valueOf(department.getMemberCount()))
      .deletedAt(
        department.hasDeletedAt()
          ? toOffsetDateTime(department.getDeletedAt())
          : null
      )
      .deletedByName(
        department.hasDeletedByName() ? department.getDeletedByName() : null
      )
      .createdAt(toOffsetDateTime(department.getCreatedAt()))
      .updatedAt(toOffsetDateTime(department.getUpdatedAt()));
  }

  private static DepartmentMemberResponseDto toDepartmentMemberResponseDto(
    DepartmentMemberResponse member
  ) {
    return new DepartmentMemberResponseDto(
      UserMapper.toUserResponseDto(member.getUser()),
      member.getIsPrimary(),
      member.hasAssignedByName() ? member.getAssignedByName() : null,
      toOffsetDateTime(member.getAssignedAt())
    );
  }

  private static OffsetDateTime toOffsetDateTime(
    com.google.protobuf.Timestamp timestamp
  ) {
    return Instant.ofEpochSecond(
      timestamp.getSeconds(),
      timestamp.getNanos()
    ).atOffset(ZoneOffset.UTC);
  }

  private DepartmentServiceGrpc.DepartmentServiceBlockingStub withMetadata(
    RequestContext context
  ) {
    return stub
      .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
      .withInterceptors(
        MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context))
      );
  }
}
