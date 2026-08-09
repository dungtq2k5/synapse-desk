import { Test, TestingModuleBuilder, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import Redis from 'ioredis';
import { of } from 'rxjs';
import { OrgStatus } from '@synapsedesk/common';
import {
  AUTH_GRPC_CLIENT,
  INGESTION_GRPC_CLIENT,
  NOTIFICATION_GRPC_CLIENT,
  RAG_GRPC_CLIENT,
  TICKET_GRPC_CLIENT,
  toProtoOrgStatus,
} from '@synapsedesk/grpc-proto';
import { AppModule } from '../../src/app.module';
import { OPS_ROUTES } from '../../src/modules/health/ops-routes';
import { setupSwagger } from '../../src/common/config/swagger.config';
import { AllHttpExceptionFilter } from '../../src/common/filters/all-http-exception.filter';
import { LoggingInterceptor } from '../../src/common/interceptors/logging.interceptor';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';
import { GrpcStubs, stubGrpcServices } from './grpc-stub';
import { Server } from 'node:http';

export type E2eFixture = {
  app: INestApplication<Server>;
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
    of({ status: toProtoOrgStatus(OrgStatus.ACTIVE), deleted: false }),
  );

  const builder = Test.createTestingModule({ imports: [AppModule] })
    // ONE stub serves ALL THREE peers. Every gRPC client in the gateway injects
    // one of these tokens and calls `getService(name)` on it — and service
    // names are unique across the three proto packages, so a single map answers
    // for auth-service's ten services, ticket-service's six and
    // ingestion-service's one alike.
    .overrideProvider(AUTH_GRPC_CLIENT)
    .useValue(clientGrpc)
    .overrideProvider(TICKET_GRPC_CLIENT)
    .useValue(clientGrpc)
    .overrideProvider(INGESTION_GRPC_CLIENT)
    .useValue(clientGrpc)
    .overrideProvider(RAG_GRPC_CLIENT)
    .useValue(clientGrpc)
    .overrideProvider(NOTIFICATION_GRPC_CLIENT)
    .useValue(clientGrpc);

  configure?.(builder);

  const moduleRef = await builder.compile();
  // `rawBody: true` mirrors main.ts, and this suite is the reason it can be
  // trusted: 14-doc §3.2 test 5 asserts the webhook receives the RAW body even
  // with the global JSON parser registered. Without the option here the test
  // would pass against a bootstrap that does not resemble production, which is
  // the failure mode the doc calls "caught by a test rather than by a
  // production outage".
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    rawBody: true,
  });
  const configService = app.get(ConfigService);

  // Everything below mirrors main.ts. A suite that skips ValidationPipe and
  // then asserts a 400 on a malformed body is asserting on code that never
  // runs in production; the same goes for the filter and the envelope.
  //
  // `trust proxy` matters more than it looks: SmartThrottlerGuard keys
  // anonymous callers on req.ip, so without it every request in a test that
  // sets X-Forwarded-For lands in the same bucket.
  app.set('trust proxy', 1);
  app.setGlobalPrefix(configService.getOrThrow<string>('GLOBAL_PREFIX'), {
    exclude: OPS_ROUTES,
  });
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

  // `/docs` and `/docs-json`, exactly as `main.ts` mounts them — 24-doc §4.
  // **Before `init()`**, which is the whole reason it lives here rather than in
  // the one suite that reads it: `SwaggerModule.setup` registers routes on the
  // Express instance, and registering them after the app has initialised
  // silently does nothing — the endpoint 404s while every static assertion
  // about the configuration passes.
  //
  // `.env.test` sets `SWAGGER_ENABLED=true`, so this also means the gate itself
  // is exercised rather than bypassed.
  setupSwagger(app, configService);

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
