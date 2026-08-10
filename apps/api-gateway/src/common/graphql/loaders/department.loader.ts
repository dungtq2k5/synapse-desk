import type { ClientGrpc } from '@nestjs/microservices';
import {
  DEPARTMENT_SERVICE_NAME,
  packRequestContext,
  type DepartmentResponse,
  type DepartmentServiceClient,
} from '@synapsedesk/grpc-proto';
import { BATCH_ID_LIMIT, type RequestContext } from '@synapsedesk/common';
import { firstValueFrom } from 'rxjs';
import { alignToKeys, createLoader } from './loaders.factory';

/**
 * The departments loader — 27-doc §3.
 *
 * The second-most-traversed edge: `Ticket.department`, `Document.departments`
 * and `User.departments` all arrive here.
 *
 * Tenant scope comes from the caller CONTEXT inside the RPC, not from anything
 * passed here — 27-doc §1, property 1. That is what makes an id-keyed cache
 * safe: the key carries no tenant, so the RPC has to be the boundary.
 */
export function createDepartmentLoader(
  client: ClientGrpc,
  context: RequestContext,
) {
  const departments = client.getService<DepartmentServiceClient>(
    DEPARTMENT_SERVICE_NAME,
  );

  return createLoader<string, DepartmentResponse>(
    async (ids) => {
      const response = await firstValueFrom(
        departments.listDepartmentsByIds(
          { departmentIds: [...ids] },
          packRequestContext(context),
        ),
      );

      return alignToKeys(ids, response.items, (department) => department.id);
    },
    { maxBatchSize: BATCH_ID_LIMIT },
  );
}
