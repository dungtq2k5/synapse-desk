import type { ClientGrpc } from '@nestjs/microservices';
import {
  DEPARTMENT_SERVICE_NAME,
  packRequestContext,
  type DepartmentServiceClient,
} from '@synapsedesk/grpc-proto';
import { BATCH_ID_LIMIT, type RequestContext } from '@synapsedesk/common';
import { firstValueFrom } from 'rxjs';
import { createCachedLoader } from './loaders.factory';
import { toDepartmentResponseGqlDto } from '../../../modules/departments/department.mapper';
import type { DepartmentResponseGqlDto } from '../../../modules/departments/dto/graphql/department-response.gql-dto';
import type { CacheService } from '../../cache/cache.service';
import { ENTITY_TTL_SECONDS, entityScope } from '../../config/cache.config';

/**
 * The departments loader.
 *
 * The second-most-traversed edge: `Ticket.department`, `Document.departments`
 * and `User.departments` all arrive here.
 *
 * Tenant scope comes from the caller CONTEXT inside the RPC, not from anything
 * passed here. That is what makes an id-keyed cache
 * safe: the key carries no tenant, so the RPC has to be the boundary.
 *
 * **Cached in Redis as well**. A department is three fields that
 * change when somebody renames one, which is roughly never, and it is read on
 * every ticket, document and user edge in the schema. The Redis key DOES carry
 * the tenant, so the two boundaries are independent: the key stops a
 * cross-tenant hit, and the RPC stops a cross-tenant fetch.
 */
export function createDepartmentLoader(
  client: ClientGrpc,
  context: () => RequestContext,
  cache: CacheService,
) {
  const departments = client.getService<DepartmentServiceClient>(
    DEPARTMENT_SERVICE_NAME,
  );

  return createCachedLoader<DepartmentResponseGqlDto>({
    cache,
    organizationId: () => context().organizationId,
    scopeOf: (id) => entityScope('department', id),
    ttlSeconds: ENTITY_TTL_SECONDS,
    keyOf: (department) => department.id,
    maxBatchSize: BATCH_ID_LIMIT,
    fetch: async (ids) => {
      const response = await firstValueFrom(
        departments.listDepartmentsByIds(
          { departmentIds: ids },
          packRequestContext(context()),
        ),
      );

      return response.items.map((department) =>
        toDepartmentResponseGqlDto(department),
      );
    },
  });
}
