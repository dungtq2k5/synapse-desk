package com.synapsedesk.gateway.graphql;

import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.departments.DepartmentGqlDto;
import com.synapsedesk.gateway.departments.DepartmentMapper;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import io.grpc.stub.MetadataUtils;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import org.dataloader.BatchLoaderEnvironment;
import org.springframework.context.annotation.Configuration;
import org.springframework.graphql.execution.BatchLoaderRegistry;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;
import synapsedesk.auth.Department.ListDepartmentsByIdsRequest;
import synapsedesk.auth.Department.ListDepartmentsByIdsResponse;
import synapsedesk.auth.DepartmentServiceGrpc;

/**
 * The departments loader — batches department lookups by id into one
 * `ListDepartmentsByIds` call per request. No entity cache (deferred, same
 * as {@link UsersLoaderConfig}). `Document.departments`
 * and `User.departments` both batch through this; `Ticket.department` will
 * too, once wired.
 *
 * <p>Same loader contract as {@link UsersLoaderConfig}: bridge at the loader
 * boundary only, caller context carried through the {@code DataLoader}'s key
 * context.
 */
@Configuration
public class DepartmentsLoaderConfig {

  private static final long DEADLINE_SECONDS = 5;

  private final DepartmentServiceGrpc.DepartmentServiceBlockingStub stub;

  public DepartmentsLoaderConfig(
    BatchLoaderRegistry registry,
    DepartmentServiceGrpc.DepartmentServiceBlockingStub stub
  ) {
    this.stub = stub;

    registry
      .forTypePair(String.class, DepartmentGqlDto.class)
      .registerMappedBatchLoader((ids, environment) ->
        Mono.fromCallable(() -> fetch(ids, environment)).subscribeOn(
          Schedulers.boundedElastic()
        )
      );
  }

  private Map<String, DepartmentGqlDto> fetch(
    Set<String> ids,
    BatchLoaderEnvironment environment
  ) {
    RequestContext context = (RequestContext) environment
      .getKeyContexts()
      .values()
      .iterator()
      .next();

    ListDepartmentsByIdsResponse response = withMetadata(
      context
    ).listDepartmentsByIds(
      ListDepartmentsByIdsRequest.newBuilder().addAllDepartmentIds(ids).build()
    );

    Map<String, DepartmentGqlDto> byId = new HashMap<>();
    for (var department : response.getItemsList()) {
      DepartmentGqlDto mapped = DepartmentMapper.toDepartmentGqlDto(department);
      byId.put(mapped.id(), mapped);
    }

    return byId;
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
