import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import { DatabaseSeeder } from '../../src/modules/prisma/database.seeder';
import { NotificationPublisher } from '../../src/modules/notifications/notification-publisher.service';
import { AuditPublisher } from '../../src/modules/audit/audit-publisher.service';
import { avatarObjectPath, SystemRoleName } from '@synapsedesk/common';
import { randomUUID } from 'node:crypto';
import { StorageReferenceService } from '../../src/modules/storage-client/storage-reference.service';

/**
 * The global roles the seeder owns — the ONLY `organization_id IS NULL` roles
 * `reset()` preserves. Anything else with a null tenant was created by a test
 * through the platform API and must go.
 *
 * Safe to interpolate into SQL: these are compile-time enum values, not input.
 */
const SEEDED_ROLE_NAMES: string[] = Object.values(SystemRoleName);

export type E2eFixture = {
  moduleRef: TestingModule;
  prisma: PrismaService;
  /**
   * Spies on the two NATS publishers.
   *
   * Both are fire-and-forget by design — they emit and never await — so there
   * is nothing downstream a test could observe. Spying is not a shortcut here;
   * it is the only way to assert that a password change told the user, or that
   * a platform action recorded `organizationId: null`. Installed by the
   * bootstrap so every suite spies on the same instance the services actually
   * hold.
   */
  notifications: {
    sendEmail: jest.SpyInstance;
    sendSms: jest.SpyInstance;
  };
  audit: { record: jest.SpyInstance };
  /**
   * Spies on the storage-service boundary.
   *
   * Stubbed for the same reason NATS is: `StorageReferenceService` speaks gRPC
   * to a separate process that this suite does not run. Left real, every call
   * would fail the deadline and `resolveReadUrls` would swallow it into `{}` —
   * so an avatar assertion would pass or fail for reasons having nothing to do
   * with the code under test.
   *
   * `resolveReadUrls` returns a recognisable fake signed URL per path, which is
   * what lets a test assert the response carries a URL rather than the raw
   * `organizations/...` object path.
   */
  storage: {
    presignAvatar: jest.SpyInstance;
    confirmAvatar: jest.SpyInstance;
    resolveReadUrls: jest.SpyInstance;
    emitSuperseded: jest.SpyInstance;
  };
  /** TRUNCATE every tenant table, re-seed, and clear the spies. Call in `beforeEach`. */
  reset: () => Promise<void>;
  close: () => Promise<void>;
};

/** The stand-in a stubbed `resolveReadUrls` hands back for a given path. */
export const signedUrlFor = (objectPath: string): string =>
  `https://signed.test/${objectPath}?X-Goog-Signature=stub`;

/**
 * Boots the real auth-service wiring — real Prisma, real services, real
 * seeder — against the TEST database (see .env.test).
 *
 * Nothing is mocked. That is the point of this layer: the unit layer already
 * proves the service does what it says with a fake repository, and every bug
 * this suite is meant to catch (partial unique indexes, transaction atomicity,
 * `ON DELETE` behaviour, concurrent writes racing to the same constraint) is
 * invisible to a mock by construction.
 */
export async function bootstrapE2eTest(): Promise<E2eFixture> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const prisma = moduleRef.get(PrismaService);
  const seeder = moduleRef.get(DatabaseSeeder);

  // `compile()` alone does not run `onModuleInit`, so nothing has connected
  // yet. `init()` fires the module lifecycle (PrismaService.$connect) without
  // creating an HTTP server or a gRPC listener — neither of which this layer
  // wants bound.
  await moduleRef.init();

  // Explicit, rather than relying on OnApplicationBootstrap: SEED_ON_BOOTSTRAP
  // is false in .env.test precisely so there is ONE seeding path. This call is
  // also what applies the partial unique indexes that live outside
  // schema.prisma — skip it and a test asserting `users_org_email_key` rejects
  // a duplicate passes for the wrong reason, because the index was never there.
  await seeder.seed();

  // Stubbed, not merely observed: `mockImplementation(() => {})` stops the real
  // publish, so the suite needs no live NATS broker and cannot leave messages
  // on a developer's queue. The call record is what the assertions read.
  const notificationPublisher = moduleRef.get(NotificationPublisher);
  const auditPublisher = moduleRef.get(AuditPublisher);

  const notifications = {
    sendEmail: jest
      .spyOn(notificationPublisher, 'sendEmail')
      .mockImplementation(() => {}),
    sendSms: jest
      .spyOn(notificationPublisher, 'sendSms')
      .mockImplementation(() => {}),
  };
  const audit = {
    record: jest.spyOn(auditPublisher, 'record').mockImplementation(() => {}),
  };

  const storageReference = moduleRef.get(StorageReferenceService);
  const storage = {
    presignAvatar: jest
      .spyOn(storageReference, 'presignAvatar')
      .mockImplementation((_input, context) =>
        Promise.resolve({
          uploadUrl: 'https://upload.test/signed',
          objectPath: avatarObjectPath(
            context.organizationId ?? 'no-tenant',
            context.sub ?? 'no-actor',
            `${randomUUID()}.png`,
          ),
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        }),
      ),
    confirmAvatar: jest
      .spyOn(storageReference, 'confirmAvatar')
      .mockResolvedValue(undefined),
    resolveReadUrls: jest
      .spyOn(storageReference, 'resolveReadUrls')
      .mockImplementation((objectPaths: string[]) =>
        Promise.resolve(
          Object.fromEntries(
            objectPaths.filter(Boolean).map((p) => [p, signedUrlFor(p)]),
          ),
        ),
      ),
    emitSuperseded: jest
      .spyOn(storageReference, 'emitSuperseded')
      .mockImplementation(() => {}),
  };

  const reset = async (): Promise<void> => {
    // Deliberately DELETE-with-predicate rather than TRUNCATE, for two reasons
    // that are not stylistic.
    //
    // First: `RolesService` memoizes the four global system role ids for the
    // process lifetime — a sound assumption in production, where the seeder
    // writes them once and nothing ever deletes them. Wiping and re-seeding
    // between tests mints NEW ids the memo does not know about, and the next
    // registration fails with "Expected 1 records to be connected, found only
    // 0" from deep inside `tx.user.create`. Preserving the rows keeps the ids
    // stable, which is also what production actually looks like.
    //
    // Second: `TRUNCATE organizations CASCADE` would take `users` with it in
    // full — CASCADE truncates every REFERENCING table, not just the matching
    // rows — and that includes the Super Admin and the system user.
    //
    // Order is child-to-parent. The tenant-user delete cascades to their
    // sessions, OTPs, backup codes and role links on its own, but the explicit
    // deletes above it also clear rows belonging to the preserved accounts.
    await prisma.$transaction([
      // The `deleted_by_id` columns are ON DELETE RESTRICT and they point the
      // WRONG WAY for a delete sweep: an organization references the user who
      // soft-deleted it, and that user references the organization. There is no
      // ordering that satisfies both, so the audit pointers are cleared first.
      // They are the only fields being discarded here that a test could have
      // set, and no test asserts on them after a reset.
      prisma.$executeRawUnsafe('UPDATE organizations SET deleted_by_id = NULL'),
      prisma.$executeRawUnsafe('UPDATE departments SET deleted_by_id = NULL'),
      prisma.$executeRawUnsafe('UPDATE users SET deleted_by_id = NULL'),

      // Billing events reference organizations with ON DELETE SetNull, so they
      // would survive the sweep as orphans and the idempotency test would then
      // hit a UNIQUE violation on a re-used event id from a previous test.
      prisma.$executeRawUnsafe('DELETE FROM billing_events'),

      prisma.$executeRawUnsafe('DELETE FROM user_departments'),
      prisma.$executeRawUnsafe('DELETE FROM user_invitations'),
      prisma.$executeRawUnsafe('DELETE FROM device_sessions'),
      prisma.$executeRawUnsafe('DELETE FROM otps'),
      prisma.$executeRawUnsafe('DELETE FROM password_reset_tokens'),
      prisma.$executeRawUnsafe('DELETE FROM two_factor_backup_codes'),
      prisma.$executeRawUnsafe('DELETE FROM departments'),

      // Roles BEFORE users: `roles.created_by_id` is RESTRICT, so a tenant role
      // created by a tenant user blocks that user's delete.
      //
      // NOT simply `organization_id IS NOT NULL`. The platform API can mint
      // GLOBAL roles — `organization_id IS NULL`, `is_system_role = true`, the
      // same shape as the seeded four — so a tenant-scope predicate alone
      // preserves them and they accumulate across the whole file. The symptom
      // is remote from the cause: `POST /platform/roles` starts failing with
      // "a global role with that name already exists" in whichever test happens
      // to run second, and the bootstrap's own "seeds exactly four system
      // roles" assertion starts counting six.
      //
      // The seeded set is identified by NAME, which is what `SystemRoleName`
      // is: the enum's values are literally the `roles.name` column contents.
      prisma.$executeRawUnsafe(
        `DELETE FROM roles WHERE organization_id IS NOT NULL OR name NOT IN (${SEEDED_ROLE_NAMES.map(
          (name) => `'${name}'`,
        ).join(', ')})`,
      ),
      prisma.$executeRawUnsafe(
        'DELETE FROM users WHERE organization_id IS NOT NULL',
      ),
      prisma.$executeRawUnsafe('DELETE FROM organizations'),
    ]);

    // Cheap now — everything it creates is already there — but kept because it
    // also re-applies the partial indexes and reconciles role -> permission
    // grants, so a test that damages either cannot leak into the next one.
    await seeder.seed();

    // Cleared here rather than in a separate `afterEach`: a stale call from the
    // previous test is exactly the kind of state that makes an assertion pass
    // for the wrong reason.
    notifications.sendEmail.mockClear();
    notifications.sendSms.mockClear();
    audit.record.mockClear();
    storage.presignAvatar.mockClear();
    storage.confirmAvatar.mockClear();
    storage.resolveReadUrls.mockClear();
    storage.emitSuperseded.mockClear();
  };

  const close = async (): Promise<void> => {
    await moduleRef.close();
  };

  return { moduleRef, prisma, notifications, audit, storage, reset, close };
}
