import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NodeEnv } from '@synapsedesk/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { GrpcExceptionFilter } from './common/filters/grpc-exception.filter';

async function bootstrap() {
  const logger = new Logger(AppModule.name);

  // Cast the app to NestExpressApplication to access underlying Express settings
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);
  const isProduction = configService.get<NodeEnv>('NODE_ENV') === 'production';

  // Tells Nestjs to listen for system shutdown signals (SIGNINT, SIGNTERM, etc.)
  app.enableShutdownHooks();

  // CRITICAL FOR PRODUCTION: Tells Express to look at X-Forwarded-For headers
  app.getHttpServer().on('listening', () => {
    app.set('trust proxy', 1);
  });

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

  // Translates downstream gRPC status codes into meaningful HTTP responses.
  // Without it every RpcException surfaces to the client as a generic 500.
  app.useGlobalFilters(new GrpcExceptionFilter());

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
  console.log(
    `🌐 [API Gateway] running on http://localhost:${port}${globalPrefix}`,
  );
}

bootstrap().catch((error) => {
  console.error('[API Gateway] Failed to start the application: ', error);
  process.exit(1);
});
