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
  FREE_PLAN_SEED,
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
  freePlanCreated: boolean;
};

/**
 * Bootstrap seeder for auth-service.
 *
 * Populates the rows the platform cannot function without, idempotently, so it
 * is safe on every startup:
 *
 *   1. `permissions`  — one row per PERMISSION_CODES entry, so RBAC codes in
 *                       the source and rows in the DB cannot drift.
 *   2. system user    — the non-login actor owning rows no human created.
 *   3. super admin    — the first real platform operator.
 *   4. system roles   — Org Admin / Knowledge Manager / Support Agent / End
 *                       User, `organization_id IS NULL`, `is_system_role`.
 *
 * Steps 1-4 run in one transaction behind a Postgres advisory lock, so the
 * database only ever moves between "unseeded" and "fully seeded" — never to a
 * half-state such as roles existing with no permissions, which would 403 every
 * request. Index creation and password hashing sit outside it deliberately.
 *
 * **Creates only what is missing, never clobbers operator changes.** An existing
 * Super Admin's password is left alone; role→permission grants ARE reconciled
 * every boot, so a newly released permission code lands on Org Admin without a
 * migration.
 */
@Injectable()
export class DatabaseSeeder implements OnApplicationBootstrap {
  private readonly logger = new Logger(DatabaseSeeder.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      // **Schema objects are not seeding, and this is the only service where
      // the distinction was ever real.** Prisma cannot express partial
      // indexes, CHECK constraints or extensions, so this block is the only
      // thing that creates them — while `SEED_ON_BOOTSTRAP` exists to skip
      // inserting ROWS, which is a decision an operator makes freely. Behind
      // one boolean, the production-looking setting removed the partial index
      // that makes a duplicate signup impossible (ADR 0020) while the catch
      // below still said serving without these was worse than not serving.
      await this.applySchemaObjects();

      if (!this.configService.getOrThrow<boolean>('SEED_ON_BOOTSTRAP')) {
        this.logger.log('SEED_ON_BOOTSTRAP is false — skipping seed ROWS');
        return;
      }

      await this.seedRows();
    } catch (err) {
      // A half-seeded database is not something the service can serve traffic
      // on: with no permissions and no roles every request 403s. Fail loudly.
      this.logger.error(`Database seeding failed: ${formatErrorMsg(err)}`);
      throw err;
    }
  }

  /**
   * Both halves, in order.
   *
   * **The name every test calls, and it keeps meaning "put this database into
   * the state a service expects".** Nine call sites outside this file rely on
   * that and one asserts on it, because `.env.test` turns `SEED_ON_BOOTSTRAP`
   * off in every service — a bare `TestingModule` does not reliably fire Nest
   * lifecycle hooks, so the fixtures call the seeder by hand. Repurposing this
   * name as the rows-only half would have stopped every e2e fixture applying
   * the schema objects, which is exactly the state the gate's own guard exists
   * to detect.
   */
  async seed(): Promise<void> {
    await this.applySchemaObjects();
    await this.seedRows();
  }

  /**
   * Everything Prisma cannot express, plus the check that the schema is there
   * at all.
   *
   * Runs on EVERY boot regardless of `SEED_ON_BOOTSTRAP`: every statement is
   * `IF NOT EXISTS` or an equivalent, so it costs one round trip per object
   * and is idempotent by construction. `development-conventions.md` §7 and
   * ADR 0039 point at this method by name — they used to name `applyIndexes`,
   * which exists in no service.
   */
  async applySchemaObjects(): Promise<void> {
    // **First, and outside the gate**, because the composition it guards
    // against is only reachable when the gate is closed: `prisma db push`
    // CREATES a missing database rather than failing, so a typo in
    // `DATABASE_URL` yields a real empty one — and a service that skipped this
    // check would boot, report healthy, and fail on the first query forever.
    await this.assertSchemaExists();

    // Deliberately OUTSIDE the transaction. `CREATE INDEX` takes an ACCESS
    // EXCLUSIVE lock on `roles` that is held until commit, so running it inside
    // would block every other reader of the table for the seed's full duration.
    // It is also DDL: idempotent on its own and not something we want rolled
    // back alongside the data.
    await this.ensureGlobalRoleNameIndex();
    await this.applyPartialIndexes();
    await this.applyCheckConstraints();
  }

  /** The row half: permissions, the system user, the bootstrap Super Admin,
   * the system roles and the free plan. Skipped when `SEED_ON_BOOTSTRAP` is
   * false, which is what that flag has always meant to an operator. */
  async seedRows(): Promise<void> {
    const startedAt = Date.now();

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
        // `$executeRaw`, NOT `$queryRaw`: pg_advisory_xact_lock() returns
        // `void`, and $queryRaw tries to deserialize the result set — which
        // fails with UnsupportedNativeDataType and takes the whole boot with
        // it. $executeRaw only reports a row count, which is all we want here;
        // the lock is the side effect, not the value.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SEED_ADVISORY_LOCK_KEY}::bigint)`;

        const permissions = await this.seedPermissions(tx);
        const systemUser = await this.seedSystemUser(tx);
        const superAdmin = await this.seedSuperAdmin(
          tx,
          superAdminPasswordHash,
        );
        const rolesCreated = await this.seedSystemRoles(tx, systemUser.id);
        const freePlan = await this.seedFreePlan(tx);

        return {
          ...permissions,
          systemUserCreated: systemUser.created,
          superAdminCreated: superAdmin.created,
          rolesCreated,
          freePlanCreated: freePlan.created,
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
    if (summary.freePlanCreated) {
      this.logger.log(
        `Created the '${FREE_PLAN_SEED.name}' plan — an unsubscribed workspace ` +
          'is now on a plan rather than on nothing',
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

      -- Department names are unique per tenant among ACTIVE rows only. Partial
      -- for the same reason as users_org_email_key: a full @@unique would keep
      -- soft-deleted rows enrolled, so the name of a deleted department could
      -- never be re-used.
      CREATE UNIQUE INDEX IF NOT EXISTS "departments_org_name_key"
        ON departments (organization_id, name)
        WHERE deleted_at IS NULL;

      -- Plan names are unique among LIVE rows only, and NOT via @unique on the
      -- column. A database-wide constraint knows nothing about \`deleted_at\`, so
      -- retiring a plan called "Pro" would block ever creating another "Pro" —
      -- permanently, for a row nothing reads. Two live plans with one name is
      -- the real hazard: the catalogue is picked from by name in the seeder and
      -- read by name by an operator.
      CREATE UNIQUE INDEX IF NOT EXISTS "subscription_plans_name_key"
        ON subscription_plans (name)
        WHERE deleted_at IS NULL;

      -- At most ONE primary department per user. The service also demotes the
      -- previous primary when setting a new one, but that check races: two
      -- concurrent "set primary" requests both read "none set" and both write.
      -- This index is the only thing that makes two primaries impossible.
      CREATE UNIQUE INDEX IF NOT EXISTS "user_departments_primary_key"
        ON user_departments (user_id)
        WHERE is_primary = true;
    `);
  }

  /**
   * Constraints Prisma cannot express.
   *
   * Adds the `users` lock CHECK: `locked_until` without `is_locked` is
   * unrepresentable, so only three of the four column states are writable.
   * `true` + past is deliberately allowed — it is the converging window between
   * an expiry passing and a mechanism noticing, not a state.
   *
   * Uses `DO $$` because Postgres has no `ADD CONSTRAINT IF NOT EXISTS`, so a
   * second boot would fail without the catalogue check.
   *
   * Runs from the seed for the same reason as the partial indexes:
   * `db push --force-reset` neither creates nor preserves a hand-written
   * constraint, so a reset would silently drop it and leave a schema that looks
   * correct.
   *
   * See `docs/decisions/0027-lock-state-is-constrained-not-conventional.md`.
   */
  private async applyCheckConstraints(): Promise<void> {
    await this.prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'users_locked_until_requires_lock'
        ) THEN
          ALTER TABLE "users"
            ADD CONSTRAINT "users_locked_until_requires_lock"
            CHECK ("locked_until" IS NULL OR "is_locked");
        END IF;
      END $$;
    `);
  }

  /**
   * Every table this service cannot start without — COUNTED, not probed.
   *
   * A single probe answers "is the database empty", and that is not the only
   * way a schema arrives incomplete: `prisma db push` interrupted partway
   * leaves `roles` present and the rest missing, which reads as success. The
   * expected set is small on purpose — the tables the seeder and the boot path
   * touch — because this is a smoke check, not a schema diff.
   */
  private async assertSchemaExists(): Promise<void> {
    const expected = ['roles', 'users', 'permissions', 'organizations'];

    const rows = await this.prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY(${expected})
    `;

    const missing = expected.filter(
      (table) => !rows.some((row) => row.table_name === table),
    );

    if (missing.length) {
      throw new Error(
        `The database is missing ${missing.length} expected table(s): ` +
          `${missing.join(', ')}. Nothing has been pushed to it, or a push ` +
          'was interrupted. Run `npm run db:push` (dev) or ' +
          '`npm run db:test:push` (test) and start again.',
      );
    }
  }

  /**
   * Fail with an ACTIONABLE message when the database has no schema at all.
   *
   * Without this the first statement of the seed is a `CREATE INDEX... ON
   * roles`, so an unmigrated database reports `relation "roles" does not exist`
   * from deep inside a raw-SQL helper — a symptom that reads like a seeder bug
   * and takes a stack trace to trace back to the real cause, which is simply
   * that nothing ever pushed the schema here. The e2e suites cannot hit it
   * (`test:e2e:auth` runs `db:test:push` first) and neither can a long-running
   * environment, so the only people who ever see it are on a fresh clone or a
   * fresh Docker volume — exactly the audience least able to interpret it.
   */
  private async ensureGlobalRoleNameIndex(): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS roles_global_name_key
         ON roles (name)
         WHERE organization_id IS NULL`,
    );
  }

  /**
   * The Free plan, so an unsubscribed workspace is on a plan like everyone else.
   *
   * **It collapses a state that carried two meanings.** `planId IS NULL` meant
   * both "free" and "grandfathered with numbers nobody chose", and nothing
   * could tell them apart — the numbers came from schema defaults that were not
   * written down anywhere a reader would look. With this row, free is a plan.
   *
   * `stripeProductId: null`, because it is assigned rather than sold: it is
   * invisible to Checkout by construction, which is right — nobody buys it.
   *
   * **Seeded from `FREE_PLAN_SEED`**, which reads off the same constant every
   * organization create uses. A second copy of the numbers here is exactly the
   * duplication this work removed.
   *
   * Idempotent on `name`, like every other seed: the row has no Stripe id to
   * key on, so the name is the identity. Existing grants are UPDATED, so
   * changing the free tier in code and restarting is enough to move it.
   */
  private async seedFreePlan(
    tx: Prisma.TransactionClient,
  ): Promise<{ created: boolean }> {
    const existing = await tx.subscriptionPlan.findFirst({
      where: { name: FREE_PLAN_SEED.name, deletedAt: null },
      select: { id: true },
    });

    if (existing) {
      await tx.subscriptionPlan.update({
        where: { id: existing.id },
        data: { ...FREE_PLAN_SEED },
      });

      return { created: false };
    }

    await tx.subscriptionPlan.create({ data: { ...FREE_PLAN_SEED } });

    return { created: true };
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
   * It carries `organizationId = null`, which per RDM forces
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
   * The first platform Super Admin (RDM) — the account that onboards
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
