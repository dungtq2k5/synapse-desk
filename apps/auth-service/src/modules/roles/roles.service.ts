import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { SystemRoleName } from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';

/**
 * Lookups for the four GLOBAL system roles (`organization_id IS NULL`).
 *
 * Split out of AuthService because two call sites needed the same query — the
 * password and Google registration paths — and both ran it on every signup for
 * a value that never changes.
 */
@Injectable()
export class RolesService {
  private readonly logger = new Logger(RolesService.name);

  /**
   * Cached for the process lifetime, with no invalidation, and that is safe for
   * exactly one reason: system roles are seeded once at boot and their ids are
   * never rewritten. A tenant admin cannot rename or delete them
   * (`is_system_role = true`), so there is no event that would stale this.
   *
   * Deliberately NOT populated in `onModuleInit`: Nest runs every module's init
   * hook BEFORE `DatabaseSeeder.onApplicationBootstrap`, so an eager read would
   * run against an unseeded database on a fresh install and cache a miss
   * forever. Lazy population sidesteps the ordering entirely.
   */
  private readonly systemRoleIds = new Map<SystemRoleName, string>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The default role every self-registered user receives.
   *
   * Takes an optional transaction client so callers inside a `$transaction` read
   * through the same connection — on a cache miss the lookup must not deadlock
   * against the transaction that is asking for it.
   */
  getEndUserRoleId(tx?: Prisma.TransactionClient): Promise<string> {
    return this.getSystemRoleId(SystemRoleName.END_USER, tx);
  }

  async getSystemRoleId(
    name: SystemRoleName,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const cached = this.systemRoleIds.get(name);
    if (cached) return cached;

    const client = tx ?? this.prisma;
    const role = await client.role.findFirst({
      // organizationId: null is what makes it the GLOBAL role rather than a
      // tenant's custom role that happens to share the name.
      where: { organizationId: null, name },
      select: { id: true },
    });
    if (!role) {
      // Unrecoverable: the seeder creates these at boot, so a miss means the
      // database was never seeded and every registration will fail the same way.
      this.logger.error(
        `System role '${name}' is missing — has the seeder run?`,
      );
      throw new RpcException({
        code: status.INTERNAL,
        message: `System role '${name}' not found`,
      });
    }

    this.systemRoleIds.set(name, role.id);
    return role.id;
  }
}
