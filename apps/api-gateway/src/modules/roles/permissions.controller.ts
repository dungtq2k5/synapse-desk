import { Controller, Get, UseGuards } from '@nestjs/common';
import { RequestContext } from '@synapsedesk/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RolesGrpcClient } from './roles-grpc.client';
import { PermissionResponseDto } from './dto/rest/role.dto';

/**
 * The seeded permission catalogue (api-endpoints-plan §1.7).
 *
 * Read-only by design: `PERMISSION_CODES` in libs/common is the source of
 * truth, the table is seeded from it, and a new permission ships with a deploy
 * rather than an API call. There is deliberately no write path.
 *
 * Its own controller rather than a route on `RolesController` because the path
 * is `/permissions`, not `/roles/...` — Nest would otherwise need a second
 * `@Controller` decorator on one class, which it does not support.
 *
 * Gated on `role.read`: the catalogue only matters to someone editing a role,
 * and it lists every capability the product has — not something to hand to
 * every authenticated user.
 */
@Controller('permissions')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class PermissionsController {
  constructor(private readonly rolesGrpcClient: RolesGrpcClient) {}

  @Get()
  @RequirePermission('role.read')
  list(
    @CurrentUser() context: RequestContext,
  ): Promise<PermissionResponseDto[]> {
    return this.rolesGrpcClient.listPermissions(context);
  }
}
