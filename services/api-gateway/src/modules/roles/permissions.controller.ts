import { CACHE_SCOPES } from '../../common/config/cache.config';
import { Cacheable } from '../../common/decorators/cacheable.decorator';
import { Controller, Get, UseGuards } from '@nestjs/common';
import { RequestContext } from '@synapsedesk/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RolesService } from './roles.service';
import { PermissionResponseDto } from './dto/rest/role-response.dto';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AUTH_SCHEMES } from '../../common/config/swagger.config';
import {
  ApiFilterErrors,
  ApiWrappedResponse,
} from '../../common/decorators/api-response.decorator';

/**
 * The seeded permission catalogue (api-endpoints-plan).
 *
 * **Read-only by design, at every level** — see
 * [ADR 0038](../../../../../docs/decisions/0038-permissions-are-a-compile-time-artifact.md).
 * There is deliberately no write path here and none on the platform side.
 *
 * Its own controller rather than a route on `RolesController` because the path
 * is `/permissions`, not `/roles/...` — Nest would otherwise need a second
 * `@Controller` decorator on one class, which it does not support.
 *
 * Gated on `role.read`: the catalogue only matters to someone editing a role,
 * and it lists every capability the product has — not something to hand to
 * every authenticated user.
 */
@ApiTags('Permissions')
@ApiCookieAuth(AUTH_SCHEMES.access)
@Controller('permissions')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class PermissionsController {
  constructor(private readonly roles: RolesService) {}

  @ApiOperation({
    summary:
      'Full permission catalogue, grouped by target prefix — drives the role editor UI',
  })
  @ApiWrappedResponse(PermissionResponseDto, { isArray: true })
  @ApiFilterErrors(['401', '403'])
  // **The hour is accepted, knowingly.** This payload is now a function of the
  // DEPLOY as well as the tenant — `isRetired` changes when `PERMISSION_CODES`
  // does — and nothing invalidates this scope, so a deploy that retires a code
  // leaves up to an hour of editors offering it. Accepted because the API
  // refuses the grant regardless: the cost is a confusing option, not a wrong
  // permission. `varyBy` cannot help — `buildKey` puts the tenant in
  // unconditionally, so there is no cross-tenant flush to reach for.
  // **A GraphQL loader writes this same key.**
  // `common/graphql/loaders/permission-catalogue.loader.ts` builds
  // `{organizationId, scope, params: {}}`, which `buildKey` renders identically
  // to this route's — so the two surfaces share one entry rather than holding
  // two copies with different ages.
  //
  // That alignment is what `varyBy` would break: switching to `'caller'` adds a
  // `__visibility` segment here and not there, and the GraphQL read would
  // silently start missing and refetching. Change the loader in the same commit.
  @Cacheable({
    scope: CACHE_SCOPES.permissions,
    ttlSeconds: 60 * 60,
    varyBy: 'tenant',
  })
  @Get()
  @RequirePermission('role.read')
  list(
    @CurrentUser() context: RequestContext,
  ): Promise<PermissionResponseDto[]> {
    return this.roles.listPermissions(context);
  }
}
