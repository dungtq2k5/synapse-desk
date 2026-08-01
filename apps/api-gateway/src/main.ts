import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AllHttpExceptionFilter } from './common/filters/all-http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { NodeEnv } from '@synapsedesk/common';

async function bootstrap() {
  const logger = new Logger(AppModule.name);

  // Cast the app to NestExpressApplication to access underlying Express settings
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

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
  app.setGlobalPrefix(globalPrefix);

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
