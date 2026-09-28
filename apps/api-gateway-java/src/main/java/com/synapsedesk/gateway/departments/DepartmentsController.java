package com.synapsedesk.gateway.departments;

import com.synapsedesk.gateway.auth.CurrentRequest;
import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.auth.UserMapper;
import com.synapsedesk.gateway.cache.CacheService;
import com.synapsedesk.gateway.generated.api.DepartmentsApi;
import com.synapsedesk.gateway.generated.model.AddDepartmentMembersDto;
import com.synapsedesk.gateway.generated.model.AddDepartmentMembersResponseDto;
import com.synapsedesk.gateway.generated.model.AuthControllerForgotPasswordV1202Response;
import com.synapsedesk.gateway.generated.model.CreateDepartmentDto;
import com.synapsedesk.gateway.generated.model.CurrentUserResponseDto.PermissionCodesEnum;
import com.synapsedesk.gateway.generated.model.DepartmentMemberResponseDto;
import com.synapsedesk.gateway.generated.model.DepartmentResponseDto;
import com.synapsedesk.gateway.generated.model.DepartmentsControllerAddMembersV1200Response;
import com.synapsedesk.gateway.generated.model.DepartmentsControllerCreateV1201Response;
import com.synapsedesk.gateway.generated.model.DepartmentsControllerListMembersV1200Response;
import com.synapsedesk.gateway.generated.model.DepartmentsControllerListMembersV1200ResponseData;
import com.synapsedesk.gateway.generated.model.DepartmentsControllerListV1200Response;
import com.synapsedesk.gateway.generated.model.DepartmentsControllerListV1200ResponseData;
import com.synapsedesk.gateway.generated.model.InvitationsControllerListV1200ResponseDataMeta;
import com.synapsedesk.gateway.generated.model.UpdateDepartmentDto;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import com.synapsedesk.gateway.security.RequirePermission;
import io.grpc.stub.MetadataUtils;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.TimeUnit;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
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
 * {@code cache.wrap} ever run, so a caller without the permission can never
 * be served an entry a privileged caller's `?includeDeleted=true` warmed.
 *
 * <p>
 * No write here evicts the cache — known gap 42, same as every other
 * `@Cacheable` route ported so far.
 */
@RestController
public class DepartmentsController implements DepartmentsApi {

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

  @Override
  @RequirePermission(PermissionCodesEnum.DEPARTMENT_READ)
  public ResponseEntity<DepartmentsControllerListV1200Response> departmentsControllerListV1(
    BigDecimal page,
    BigDecimal limit,
    String sortOrder,
    String searchTerm,
    String sortBy,
    Boolean includeDeleted
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
      throw new ResponseStatusException(
        HttpStatus.FORBIDDEN,
        "Using 'includeDeleted' requires the department.delete permission"
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

    DepartmentsControllerListV1200Response envelope = cache.wrap(
      key,
      LIST_CACHE_TTL_SECONDS,
      DepartmentsControllerListV1200Response.class,
      () -> {
        PageRequest.Builder pageRequest = PageRequest.newBuilder()
          .setPage(page.intValue())
          .setLimit(limit.intValue())
          .setSortBy(sortBy)
          .setSortOrder(
            "DESC".equalsIgnoreCase(sortOrder)
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

        DepartmentsControllerListV1200ResponseData data =
          new DepartmentsControllerListV1200ResponseData()
            .items(
              response
                .getItemsList()
                .stream()
                .map(DepartmentsController::toDepartmentResponseDto)
                .toList()
            )
            .meta(toMetaDto(response.getMeta()));

        return new DepartmentsControllerListV1200Response()
          .success(true)
          .statusCode(BigDecimal.valueOf(200))
          .message("OK")
          .data(data);
      }
    );

    return ResponseEntity.ok(envelope);
  }

  @Override
  @RequirePermission(PermissionCodesEnum.DEPARTMENT_READ)
  public ResponseEntity<DepartmentsControllerCreateV1201Response> departmentsControllerGetV1(
    String id
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    DepartmentResponse response = withMetadata(context).getDepartment(
      GetDepartmentRequest.newBuilder().setId(id).build()
    );

    return okDepartment(response, "OK", 200);
  }

  @Override
  @RequirePermission(PermissionCodesEnum.DEPARTMENT_CREATE)
  public ResponseEntity<DepartmentsControllerCreateV1201Response> departmentsControllerCreateV1(
    CreateDepartmentDto createDepartmentDto
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

  @Override
  @RequirePermission(PermissionCodesEnum.DEPARTMENT_UPDATE)
  public ResponseEntity<DepartmentsControllerCreateV1201Response> departmentsControllerUpdateV1(
    String id,
    UpdateDepartmentDto updateDepartmentDto
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

  @Override
  @RequirePermission(PermissionCodesEnum.DEPARTMENT_DELETE)
  public ResponseEntity<AuthControllerForgotPasswordV1202Response> departmentsControllerRemoveV1(
    String id
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    withMetadata(context).deleteDepartment(
      DepartmentIdRequest.newBuilder().setId(id).build()
    );

    return ResponseEntity.ok(
      new AuthControllerForgotPasswordV1202Response()
        .success(true)
        .statusCode(BigDecimal.valueOf(200))
        .message("Department deleted")
        .data(null)
    );
  }

  @Override
  @RequirePermission(PermissionCodesEnum.DEPARTMENT_DELETE)
  public ResponseEntity<DepartmentsControllerCreateV1201Response> departmentsControllerRestoreV1(
    String id
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    DepartmentResponse response = withMetadata(context).restoreDepartment(
      DepartmentIdRequest.newBuilder().setId(id).build()
    );

    return okDepartment(response, "Department restored", 200);
  }

  @Override
  @RequirePermission(PermissionCodesEnum.DEPARTMENT_READ)
  public ResponseEntity<DepartmentsControllerListMembersV1200Response> departmentsControllerListMembersV1(
    String id,
    BigDecimal page,
    BigDecimal limit,
    String sortOrder,
    String searchTerm,
    String sortBy
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    PageRequest.Builder pageRequest = PageRequest.newBuilder()
      .setPage(page.intValue())
      .setLimit(limit.intValue())
      .setSortBy(sortBy)
      .setSortOrder(
        "DESC".equalsIgnoreCase(sortOrder)
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

    DepartmentsControllerListMembersV1200ResponseData data =
      new DepartmentsControllerListMembersV1200ResponseData()
        .items(
          response
            .getItemsList()
            .stream()
            .map(DepartmentsController::toDepartmentMemberResponseDto)
            .toList()
        )
        .meta(toMetaDto(response.getMeta()));

    return ResponseEntity.ok(
      new DepartmentsControllerListMembersV1200Response()
        .success(true)
        .statusCode(BigDecimal.valueOf(200))
        .message("OK")
        .data(data)
    );
  }

  @Override
  @RequirePermission(PermissionCodesEnum.DEPARTMENT_MEMBER_ASSIGN)
  public ResponseEntity<DepartmentsControllerAddMembersV1200Response> departmentsControllerAddMembersV1(
    String id,
    AddDepartmentMembersDto addDepartmentMembersDto
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
      new DepartmentsControllerAddMembersV1200Response()
        .success(true)
        .statusCode(BigDecimal.valueOf(200))
        .message("Members assigned")
        .data(
          new AddDepartmentMembersResponseDto(
            BigDecimal.valueOf(response.getAddedCount()),
            BigDecimal.valueOf(response.getUpdatedCount())
          )
        )
    );
  }

  @Override
  @RequirePermission(PermissionCodesEnum.DEPARTMENT_MEMBER_ASSIGN)
  public ResponseEntity<AuthControllerForgotPasswordV1202Response> departmentsControllerRemoveMemberV1(
    String id,
    String userId
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    withMetadata(context).removeDepartmentMember(
      RemoveDepartmentMemberRequest.newBuilder()
        .setDepartmentId(id)
        .setUserId(userId)
        .build()
    );

    return ResponseEntity.ok(
      new AuthControllerForgotPasswordV1202Response()
        .success(true)
        .statusCode(BigDecimal.valueOf(200))
        .message("Member removed")
        .data(null)
    );
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

  private static ResponseEntity<DepartmentsControllerCreateV1201Response> okDepartment(
    DepartmentResponse response,
    String message,
    int status
  ) {
    return ResponseEntity.status(status).body(
      new DepartmentsControllerCreateV1201Response()
        .success(true)
        .statusCode(BigDecimal.valueOf(status))
        .message(message)
        .data(toDepartmentResponseDto(response))
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

  private static InvitationsControllerListV1200ResponseDataMeta toMetaDto(
    synapsedesk.auth.Common.PageMeta meta
  ) {
    return new InvitationsControllerListV1200ResponseDataMeta(
      BigDecimal.valueOf(meta.getTotalItems()),
      BigDecimal.valueOf(meta.getItemCount()),
      BigDecimal.valueOf(meta.getItemsPerPage()),
      BigDecimal.valueOf(meta.getTotalPages()),
      BigDecimal.valueOf(meta.getCurrentPage())
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
