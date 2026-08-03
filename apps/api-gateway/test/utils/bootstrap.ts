import { Test, TestingModuleBuilder, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import Redis from 'ioredis';
import { of } from 'rxjs';
import { OrgStatus } from '@synapsedesk/common';
import { AUTH_GRPC_CLIENT } from '@synapsedesk/grpc-proto';
import { AppModule } from '../../src/app.module';
import { AllHttpExceptionFilter } from '../../src/common/filters/all-http-exception.filter';
import { LoggingInterceptor } from '../../src/common/interceptors/logging.interceptor';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';
import { GrpcStubs, stubGrpcServices } from './grpc-stub';

export type E2eFixture = {
  app: INestApplication;
  moduleRef: TestingModule;
  stubs: GrpcStubs;
  close: () => Promise<void>;
};

/**
 * Boots the gateway's real HTTP stack with the gRPC layer stubbed.
 *
 * The gateway owns no data, so what it can prove alone is the boundary:
 * guards, pipes, the exception filter, the response envelope, cookie flags.
 * Keeping a live auth-service out of that loop is deliberate — with one in, a
 * failing assertion no longer tells you which side broke, and the suite stops
 * being runnable without a database.
 */
export async function bootstrapE2eTest(
  configure?: (builder: TestingModuleBuilder) => void,
): Promise<E2eFixture> {
  const { stubs, clientGrpc } = stubGrpcServices();

  // A default for the tenant lifecycle gate.
  //
  // `OrganizationStatusInterceptor` runs on essentially EVERY authenticated
  // request, and it calls this RPC. Left unstubbed the mock returns undefined,
  // the interceptor cannot subscribe to it, and every gated route answers 500 —
  // in a suite that is testing something else entirely. Worse, an assertion
  // like `expect(status).not.toBe(403)` passes against that 500, so the
  // breakage hides until a stricter test finds it.
  //
  // ACTIVE and not deleted is the state almost every test wants. A test about
  // the gate itself overrides it.
  stubs.organization.getOrganizationStatus.mockReturnValue(
    of({ status: OrgStatus.ACTIVE, deleted: false }),
  );

  const builder = Test.createTestingModule({ imports: [AppModule] })
    // One override covers all ten services: every gRPC client in the gateway
    // injects this single token and calls getService() on it.
    .overrideProvider(AUTH_GRPC_CLIENT)
    .useValue(clientGrpc);

  configure?.(builder);

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();

  // Everything below mirrors main.ts. A suite that skips ValidationPipe and
  // then asserts a 400 on a malformed body is asserting on code that never
  // runs in production; the same goes for the filter and the envelope.
  //
  // `trust proxy` matters more than it looks: SmartThrottlerGuard keys
  // anonymous callers on req.ip, so without it every request in a test that
  // sets X-Forwarded-For lands in the same bucket.
  app.set('trust proxy', 1);
  app.setGlobalPrefix(process.env.GLOBAL_PREFIX ?? '/api/v1');
  app.use(cookieParser());
  app.useGlobalFilters(new AllHttpExceptionFilter(false));
  app.useGlobalInterceptors(new LoggingInterceptor(true));
  app.useGlobalInterceptors(new TransformInterceptor(app.get(Reflector)));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.init();

  return {
    app,
    moduleRef,
    stubs,
    close: () => app.close(),
  };
}

/**
 * Clears the test Redis keyspace (DB 15 — see .env.test).
 *
 * Both the throttler and the organization-status cache live there, and both
 * outlive a single test by design: a 15-minute throttle window does not reset
 * because a new `describe` started. Without this, the second run of a suite
 * behaves differently from the first, which is the worst kind of flake because
 * it looks like a real regression.
 */
export async function flushTestRedis(): Promise<void> {
  const redis = new Redis(process.env.REDIS_URL as string, {
    maxRetriesPerRequest: 1,
  });
  try {
    await redis.flushdb();
  } finally {
    redis.disconnect();
  }
}
