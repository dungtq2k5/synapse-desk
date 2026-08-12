import { Test, TestingModule } from '@nestjs/testing';
import { ClientProxy } from '@nestjs/microservices';
import { of } from 'rxjs';
import { NATS_CLIENT } from '@synapsedesk/common';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import { DatabaseSeeder } from '../../src/modules/prisma/database.seeder';

export type E2eFixture = {
  moduleRef: TestingModule;
  prisma: PrismaService;
  /** Every subject this service published during the test. */
  emitted: Array<{ pattern: string; payload: unknown }>;
  /** Empty the feed. Call in `beforeEach`. */
  reset: () => Promise<void>;
  close: () => Promise<void>;
};

/**
 * Boots the real notification-service wiring against the TEST database.
 *
 * The collaborators that reach outside the process — auth-service over gRPC and
 * SMTP — are spied on by the suites rather than stubbed here, because what each
 * test wants to control differs: one varies the audience, another asserts on
 * the captured mail.
 *
 * **NATS is the exception and IS stubbed here**, because it is not a
 * collaborator a suite varies: every test wants the same thing from it, which
 * is a record of what was published. A real client would try to reach a broker
 * and every emit would fail identically.
 */
export async function bootstrapE2eTest(): Promise<E2eFixture> {
  const emitted: Array<{ pattern: string; payload: unknown }> = [];

  const natsStub = {
    emit: (pattern: unknown, payload: unknown) => {
      emitted.push({ pattern: String(pattern), payload });

      // A real observable, like the client's, so a caller that subscribes gets
      // a completion rather than hanging. It records on CREATION rather than on
      // subscribe deliberately: the tests here assert what a publisher tried to
      // send, and `emit()` being cold is a property of the production client
      // that `notification-realtime.publisher.ts` already accounts for with its
      // explicit `.subscribe()`.
      return of(undefined);
    },
  } as unknown as ClientProxy;

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(NATS_CLIENT)
    .useValue(natsStub)
    .compile();

  const prisma = moduleRef.get(PrismaService);

  // `compile()` alone does not fire `onModuleInit`, so nothing has connected.
  await moduleRef.init();

  // Explicit, rather than relying on `OnApplicationBootstrap`:
  // SEED_ON_BOOTSTRAP is false in .env.test precisely so there is ONE seeding
  // path. This is what applies the four PARTIAL indexes — skip it and the
  // idempotency test passes on the service-layer catch alone, proving nothing
  // about the constraint it claims to exercise.
  await moduleRef.get(DatabaseSeeder).seed();

  const reset = async (): Promise<void> => {
    // CASCADE takes `notification_deliveries` with it, which is the point of
    // the FK — a delivery row describing a notification that no longer exists
    // is a row nothing can join back.
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE "notification_deliveries", "notification_preferences",
        -- The one-auto-reply-per-day guard (32-doc §5). A row surviving into
        -- the next test suppresses that test's first reply, which reads as the
        -- consumer being broken rather than as a dirty fixture.
        "inbound_auto_replies",
        "notifications" RESTART IDENTITY CASCADE;
    `);
    emitted.length = 0;
  };

  const close = async (): Promise<void> => {
    await reset();
    await moduleRef.close();
  };

  return { moduleRef, prisma, emitted, reset, close };
}
