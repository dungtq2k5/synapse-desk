import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/modules/prisma/prisma.service';

export type E2eFixture = {
  moduleRef: TestingModule;
  prisma: PrismaService;
  /** Empty the feed. Call in `beforeEach`. */
  reset: () => Promise<void>;
  close: () => Promise<void>;
};

/**
 * Boots the real notification-service wiring against the TEST database.
 *
 * The two collaborators that reach outside the process — auth-service over
 * gRPC and SMTP — are spied on by the suites rather than stubbed here, because
 * what each test wants to control differs: one varies the audience, another
 * asserts on the captured mail.
 */
export async function bootstrapE2eTest(): Promise<E2eFixture> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const prisma = moduleRef.get(PrismaService);

  // `compile()` alone does not fire `onModuleInit`, so nothing has connected.
  await moduleRef.init();

  const reset = async (): Promise<void> => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "notifications"');
  };

  const close = async (): Promise<void> => {
    await reset();
    await moduleRef.close();
  };

  return { moduleRef, prisma, reset, close };
}
