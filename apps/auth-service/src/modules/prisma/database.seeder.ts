import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import {
  Gender,
  normalizeEmail,
  PERMISSION_CODES,
  PERMISSION_NAMES,
  SYSTEM_ROLE_DESCRIPTIONS,
  SYSTEM_ROLE_PERMISSIONS,
  SystemRoleName,
  formatErrorMsg,
} from '@synapsedesk/common';
import { PrismaService } from './prisma.service';
import { Prisma } from '../../generated/prisma/client';

/**
 * Serializes the seed across service replicas. Any arbitrary but *stable* key
 * works — every process that wants to seed must agree on the same number.
 * Released automatically when the transaction commits or rolls back.
 */
const SEED_ADVISORY_LOCK_KEY = 4_729_101_845;

/** Ceiling for the whole seed transaction, including time spent waiting on the
 * advisory lock while another replica seeds. */
const SEED_TRANSACTION_TIMEOUT_MS = 30_000;
const SEED_TRANSACTION_MAX_WAIT_MS = 15_000;

/** What the transaction actually changed, so the log reflects a COMMITTED state
 * rather than intentions that a rollback may have thrown away. */
type SeedSummary = {
  permissionsCreated: number;
  retiredPermissionCodes: string[];
  systemUserCreated: boolean;
  superAdminCreated: boolean;
  rolesCreated: string[];
};

/**
 * Bootstrap seeder for auth-service.
 *
 * Populates the rows the platform cannot function without — the permission
 * catalogue, the global system roles, the system actor and the first Super
 * Admin — and does so idempotently, so it is safe to run on every startup:
 *
 *   1. `permissions`  — one row per PERMISSION_CODES entry, so RBAC codes in
 *                       the source and rows in the DB cannot drift.
 *   2. system user    — the non-login actor that owns rows no human created
 *                       (`roles.created_by_id` on global system roles).
 *   3. super admin    — the first real platform operator (RDM §1.7).
 *   4. system roles   — Org Admin / Knowledge Manager / Support Agent / End
 *                       User, `organization_id IS NULL`, `is_system_role`.
 *
 * Steps 1-4 run in a single transaction guarded by a Postgres advisory lock, so
 * the database only ever moves between "unseeded" and "fully seeded" — never to
 * a half-state such as roles existing with no permissions attached, which would
 * 403 every request. The index creation and password hashing that bracket it
 * are deliberately outside; see the comments in `seed()`.
 *
 * "Smart" here means: create only what is missing, never clobber operator
 * changes. Specifically, an existing Super Admin's password is left alone (so a
 * rotated password is not reset to the .env value on the next deploy), while
 * role→permission grants ARE reconciled every boot so that a newly released
 * permission code lands on Org Admin without a manual migration.
 */
@Injectable()
export class DatabaseSeeder implements OnApplicationBootstrap {
  private readonly logger = new Logger(DatabaseSeeder.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.configService.getOrThrow<boolean>('SEED_ON_BOOTSTRAP')) {
      this.logger.log('SEED_ON_BOOTSTRAP is false — skipping database seed');
      return;
    }

    try {
      await this.seed();
    } catch (err) {
      // A half-seeded database is not something the service can serve traffic
      // on: with no permissions and no roles every request 403s. Fail loudly.
      this.logger.error(`Database seeding failed: ${formatErrorMsg(err)}`);
      throw err;
    }
  }

  async seed(): Promise<void> {
    const startedAt = Date.now();

    // Deliberately OUTSIDE the transaction. `CREATE INDEX` takes an ACCESS
    // EXCLUSIVE lock on `roles` that is held until commit, so running it inside
    // would block every other reader of the table for the seed's full duration.
    // It is also DDL: idempotent on its own and not something we want rolled
    // back alongside the data.
    await this.ensureGlobalRoleNameIndex();
    await this.applyPartialIndexes();

    // Hash before opening the transaction: bcrypt is deliberately slow and
    // CPU-bound, and holding a pooled connection open across it is wasteful.
    const superAdminPasswordHash = await this.hashSuperAdminPassword();

    const summary = await this.prisma.$transaction(
      async (tx) => {
        // Serialize concurrently-booting replicas. Without this, two processes
        // both pass the "does it exist?" checks below and race to insert; the
        // loser dies on a unique violation and takes the service down with it.
        // Whoever arrives second blocks here, then finds everything present and
        // no-ops. The lock is transaction-scoped, so it always releases.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(${SEED_ADVISORY_LOCK_KEY}::bigint)`;

        const permissions = await this.seedPermissions(tx);
        const systemUser = await this.seedSystemUser(tx);
        const superAdmin = await this.seedSuperAdmin(
          tx,
          superAdminPasswordHash,
        );
        const rolesCreated = await this.seedSystemRoles(tx, systemUser.id);

        return {
          ...permissions,
          systemUserCreated: systemUser.created,
          superAdminCreated: superAdmin.created,
          rolesCreated,
        } satisfies SeedSummary;
      },
      {
        timeout: SEED_TRANSACTION_TIMEOUT_MS,
        maxWait: SEED_TRANSACTION_MAX_WAIT_MS,
      },
    );

    this.report(summary, Date.now() - startedAt);
  }

  /** Logged only after the transaction commits, so nothing here can describe a
   * write that was rolled back. */
  private report(summary: SeedSummary, elapsedMs: number): void {
    if (summary.permissionsCreated) {
      this.logger.log(`Created ${summary.permissionsCreated} permission(s)`);
    }
    if (summary.retiredPermissionCodes.length) {
      this.logger.warn(
        `${summary.retiredPermissionCodes.length} permission row(s) are no longer in ` +
          `PERMISSION_CODES and were left untouched: ` +
          summary.retiredPermissionCodes.join(', '),
      );
    }
    if (summary.systemUserCreated) {
      this.logger.log(
        `Created system user '${this.configService.getOrThrow<string>('SYSTEM_USER_EMAIL')}'`,
      );
    }
    if (summary.superAdminCreated) {
      this.logger.warn(
        `Created bootstrap Super Admin ` +
          `'${this.configService.getOrThrow<string>('SUPER_ADMIN_EMAIL')}' from ` +
          'SUPER_ADMIN_PASSWORD — change this password immediately and remove ' +
          'it from the environment',
      );
    }
    if (summary.rolesCreated.length) {
      this.logger.log(
        `Created system role(s): ${summary.rolesCreated.join(', ')}`,
      );
    }

    this.logger.log(`Database seed completed in ${elapsedMs}ms`);
  }

  /**
   * Returns the hash for a *potential* Super Admin creation. Computed
   * unconditionally because the existence check happens inside the transaction;
   * it is simply discarded when the account is already there.
   */
  private async hashSuperAdminPassword(): Promise<string> {
    const password = this.configService.getOrThrow<string>(
      'SUPER_ADMIN_PASSWORD',
    );

    return bcrypt.hash(
      password,
      Number(this.configService.getOrThrow('BCRYPT_ROUNDS')),
    );
  }

  /**
   * PostgreSQL does not treat NULLs as equal, so the `@@unique([organizationId,
   * name])` constraint does not stop two global roles sharing a name. Without
   * this partial index, two service replicas booting at once would each pass
   * the "does it exist?" check and insert a duplicate "Org Admin".
   *
   * This belongs in a migration; it is asserted here as well because the
   * seeder's correctness depends on it and `prisma/migrations` does not exist
   * yet. `IF NOT EXISTS` makes it a no-op once the migration lands.
   */
  /**
   * Every index that cannot live in schema.prisma, applied in one place.
   *
   * Prisma's `@@unique` compiles to a FULL unique index with no WHERE support
   * (prisma#6974), but every constraint here is partial:
   *   - filtered on `deleted_at` so deactivating a user frees their address for
   *     re-use — the re-hire case
   *   - split for `organization_id IS NULL`, because Postgres does not treat
   *     NULLs as equal, so Super Admins need their own guard
   *   - filtered on `status = 'PENDING'` so a revoked invite does not block a
   *     fresh one
   *
   * Run from the SEED rather than a one-off psql command: `db push --force-reset`
   * neither creates nor preserves them, so a reset would silently drop the
   * constraint and leave a schema that looks correct. Idempotent, so
   * `prisma db push && prisma db seed` reproduces a complete schema every time.
   */
  private async applyPartialIndexes(): Promise<void> {
    await this.prisma.$executeRawUnsafe(`
      -- Belt-and-braces: removing @unique makes db push drop this, but a
      -- database predating the schema change still carries it.
      DROP INDEX IF EXISTS "users_email_key";

      CREATE UNIQUE INDEX IF NOT EXISTS "users_org_email_key"
        ON users (organization_id, email)
        WHERE deleted_at IS NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS "users_super_admin_email_key"
        ON users (email)
        WHERE organization_id IS NULL AND deleted_at IS NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS "user_invitations_pending_key"
        ON user_invitations (organization_id, email)
        WHERE status = 'PENDING';
    `);
  }

  private async ensureGlobalRoleNameIndex(): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS roles_global_name_key
         ON roles (name)
         WHERE organization_id IS NULL`,
    );
  }

  /**
   * Mirrors PERMISSION_CODES into the `permissions` table.
   *
   * Codes removed from the source array are deliberately left in place: tenant
   * custom roles may still reference them, and dropping the row would cascade
   * that grant away silently. Retired codes are reported instead.
   */
  private async seedPermissions(
    tx: Prisma.TransactionClient,
  ): Promise<
    Pick<SeedSummary, 'permissionsCreated' | 'retiredPermissionCodes'>
  > {
    const { count } = await tx.permission.createMany({
      data: PERMISSION_CODES.map((code) => ({
        code,
        name: PERMISSION_NAMES[code],
      })),
      skipDuplicates: true,
    });

    const retired = await tx.permission.findMany({
      where: { code: { notIn: [...PERMISSION_CODES] } },
      select: { code: true },
    });

    return {
      permissionsCreated: count,
      retiredPermissionCodes: retired.map((p) => p.code),
    };
  }

  /**
   * The system actor. It satisfies `roles.created_by_id` (non-nullable) on the
   * global system roles without attributing them to a tenant admin.
   *
   * It carries `organizationId = null`, which per RDM §1.7 forces
   * `isSuperAdmin = true`. It is therefore hardened against ever being used as
   * a login: no password hash, and `isLocked = true` — which `AuthService.login`
   * rejects before any token is minted.
   */
  private async seedSystemUser(
    tx: Prisma.TransactionClient,
  ): Promise<{ id: string; created: boolean }> {
    const email = normalizeEmail(
      this.configService.getOrThrow<string>('SYSTEM_USER_EMAIL'),
    );
    const fullName = this.configService.getOrThrow<string>(
      'SYSTEM_USER_FULL_NAME',
    );

    // findFirst, not findUnique: email is unique per TENANT now, so there is no
    // unique index on email alone to key off. Both seeded accounts are Super
    // Admins, so the scope is `organizationId: null` — guarded in the database
    // by users_super_admin_email_key.
    const existing = await tx.user.findFirst({
      where: { email, organizationId: null, deletedAt: null },
      select: { id: true },
    });
    if (existing) return { id: existing.id, created: false };

    const systemUser = await tx.user.create({
      data: {
        email,
        fullName,
        organizationId: null,
        isSuperAdmin: true,
        passwordHash: null,
        isEmailVerified: true,
        gender: Gender.UNSPECIFIED,
        isLocked: true,
      },
      select: { id: true },
    });

    return { id: systemUser.id, created: true };
  }

  /**
   * The first platform Super Admin (RDM §1.7) — the account that onboards
   * tenants before any tenant exists.
   *
   * Only created when absent. If the account already exists the .env password
   * is ignored, so redeploying never resurrects a rotated or leaked credential.
   */
  private async seedSuperAdmin(
    tx: Prisma.TransactionClient,
    passwordHash: string,
  ): Promise<{ id: string; created: boolean }> {
    const email = normalizeEmail(
      this.configService.getOrThrow<string>('SUPER_ADMIN_EMAIL'),
    );
    const fullName = this.configService.getOrThrow<string>(
      'SUPER_ADMIN_FULL_NAME',
    );

    const existing = await tx.user.findFirst({
      where: { email, organizationId: null, deletedAt: null },
      select: { id: true },
    });
    if (existing) return { id: existing.id, created: false };

    const superAdmin = await tx.user.create({
      data: {
        email,
        fullName,
        organizationId: null,
        isSuperAdmin: true,
        passwordHash,
        isEmailVerified: true,
        gender: Gender.UNSPECIFIED,
      },
      select: { id: true },
    });

    return { id: superAdmin.id, created: true };
  }

  /**
   * Creates the four global system roles and reconciles their permission sets.
   *
   * `upsert` is not usable here: Prisma types the `organizationId_name`
   * compound-unique input as a non-nullable string, so a global role
   * (`organizationId: null`) cannot be addressed through it. findFirst +
   * create/update is the equivalent, with the partial unique index above
   * guarding the race between the read and the write.
   */
  private async seedSystemRoles(
    tx: Prisma.TransactionClient,
    systemUserId: string,
  ): Promise<string[]> {
    const created: string[] = [];

    for (const roleName of Object.values(SystemRoleName)) {
      // The enum values ARE the role names; widening to string keeps them
      // usable in template literals and Prisma's `name` input alike.
      const name: string = roleName;
      const codes = SYSTEM_ROLE_PERMISSIONS[roleName];
      const description = SYSTEM_ROLE_DESCRIPTIONS[roleName];

      const existing = await tx.role.findFirst({
        where: { organizationId: null, name },
        select: { id: true },
      });

      if (!existing) {
        await tx.role.create({
          data: {
            name,
            description,
            organizationId: null,
            isSystemRole: true,
            createdById: systemUserId,
            permissions: { connect: codes.map((code) => ({ code })) },
          },
        });
        created.push(`${name} (${codes.length} permission(s))`);
        continue;
      }

      // `set` is a full replacement, so a code dropped from the role's default
      // grant is revoked here too — system roles are ours to define, not the
      // tenant's to edit.
      await tx.role.update({
        where: { id: existing.id },
        data: {
          description,
          isSystemRole: true,
          permissions: { set: codes.map((code) => ({ code })) },
        },
      });
    }

    return created;
  }
}
