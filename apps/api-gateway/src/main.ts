import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import { OPS_ROUTES } from './modules/health/ops-routes';
import { MetricsServer } from './modules/metrics/metrics.server';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AllHttpExceptionFilter } from './common/filters/all-http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { MicroserviceOptions } from '@nestjs/microservices';
import { createNatsTransport, NodeEnv } from '@synapsedesk/common';
import { RedisIoAdapter } from './common/adapters/redis-io.adapter';

async function bootstrap() {
  const logger = new Logger(AppModule.name);

  // Cast the app to NestExpressApplication to access underlying Express settings
  //
  // `rawBody: true` is NOT optional — it is the fix for 14-doc §3.2, the single
  // most common way a Stripe integration fails on first deploy. Stripe's
  // signature is computed over the EXACT BYTES of the request; the global JSON
  // parser deserializes and re-serializes them, and verification then fails for
  // every event. This buffers the original bytes before that happens, and
  // `POST /webhooks/stripe` reads them from `req.rawBody`.
  //
  // Buffering globally rather than mounting a raw parser on the webhook path
  // costs a little memory per request and removes a coupling that would
  // otherwise bite: a path-mounted parser has to know the GLOBAL PREFIX, so
  // changing `GLOBAL_PREFIX` would silently stop it applying — and the symptom
  // is exactly the one this option exists to prevent, arriving from a config
  // change nobody would connect to billing.
  //
  // The failure shape is what makes it worth this comment: locally it often
  // works (fewer middleware layers), in production every webhook 400s, and
  // entitlements silently stop tracking subscriptions while the app looks
  // entirely healthy.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  // CRITICAL FOR PRODUCTION: tells Express to read X-Forwarded-For, which is
  // what makes `req.ip` the real client rather than the load balancer. Set
  // immediately, not from a 'listening' handler — everything downstream that
  // records provenance (device_sessions.ip_address, password_reset_tokens,
  // audit_logs) is silently wrong if this has not been applied.
  //
  // The value is a HOP COUNT: `1` means exactly one trusted proxy. Behind both
  // an ALB and Nginx it must be 2, or req.ip is Nginx's address.
  app.set('trust proxy', 1);

  const configService = app.get(ConfigService);

  // Tells Nestjs to listen for system shutdown signals (SIGNINT, SIGNTERM, etc.)
  app.enableShutdownHooks();

  // Set global prefix for all routes
  const globalPrefix = configService.getOrThrow<string>('GLOBAL_PREFIX');
  app.setGlobalPrefix(globalPrefix, { exclude: OPS_ROUTES });

  // Enable cookie parser (cookieParser is a factory — it must be invoked)
  app.use(cookieParser());

  // Enable CORS for all origins
  app.enableCors({
    origin: configService.getOrThrow<string>('CORS').split(','),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  });

  const isProduction =
    configService.getOrThrow<NodeEnv>('NODE_ENV') === 'production';

  // Terminal error handler for HTTP and GraphQL alike. Without it every
  // downstream RpcException surfaces to the client as a generic 500.
  app.useGlobalFilters(new AllHttpExceptionFilter(isProduction));

  // Per-request timings outside production; errors always.
  app.useGlobalInterceptors(new LoggingInterceptor(isProduction));

  // Wraps successful responses in the same envelope AllHttpExceptionFilter uses
  // for failures, so `success` is the one field a client branches on.
  //
  // Registered AFTER LoggingInterceptor, which makes it the inner of the two:
  // Nest runs global interceptors in registration order on the way in and
  // unwinds in reverse, so the logger observes the handler's own duration
  // rather than the envelope-building around it.
  app.useGlobalInterceptors(new TransformInterceptor(app.get(Reflector)));

  // Add validation pipe for all routes
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  /**
   * Socket.IO over Redis pub/sub.
   *
   * Awaited BEFORE `useWebSocketAdapter`, because `createIOServer` runs
   * synchronously the moment the first gateway initialises and cannot wait for
   * a connection that has not been made — attaching the adapter afterwards is a
   * no-op that presents as "works locally, drops half the events in staging".
   */
  const redisIoAdapter = new RedisIoAdapter(app, configService);
  await redisIoAdapter.connect();
  app.useWebSocketAdapter(redisIoAdapter);

  /**
   * The gateway is a HYBRID app: HTTP for clients, plus a NATS consumer.
   *
   * It subscribes to the `ticket.*` domain events ticket-service publishes and
   * relays them into WebSocket rooms. It publishes nothing — the direction is
   * one-way by design, and a gateway that emitted domain events would be a
   * gateway with business logic in it.
   *
   * `startAllMicroservices` before `listen`: a client that connects the instant
   * the HTTP port opens must not find a socket layer with no event source
   * behind it.
   */
  app.connectMicroservice<MicroserviceOptions>(
    createNatsTransport(configService),
  );
  await app.startAllMicroservices();

  // The metrics listener, BEFORE the public one — 23-doc §4. A scraper that
  // finds the app serving traffic and the metrics port refused would report a
  // scrape failure for a process that is perfectly healthy.
  //
  // A separate listener rather than a route: it is what makes "not reachable
  // from the internet" a property of this process rather than of an Nginx
  // config living in another repository.
  await app.get(MetricsServer).listen();

  const port = configService.getOrThrow<number>('PORT');
  await app.listen(port);
  logger.log(
    `🌐 [API Gateway] running on http://localhost:${port}${globalPrefix}`,
  );
}

bootstrap().catch((error) => {
  console.error('[API Gateway] Failed to start the application: ', error);
  process.exit(1);
});
