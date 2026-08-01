// Populates process.env before the transport options below are computed.
import 'dotenv/config';

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger(AppModule.name);
  const url = process.env.NATS_URL!;

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.NATS,
      options: {
        servers: [url],
        /**
         * A queue group, so N replicas of this service SHARE the subscription:
         * each message is delivered to exactly one of them. Without it every
         * replica handles every event and the user gets N copies of each email.
         */
        queue: 'notification_service_queue',
      },
    },
  );

  app.enableShutdownHooks();

  await app.listen();
  logger.log(`📮 [Notification Service] listening on NATS at ${url}`);
}

bootstrap().catch((error) => {
  console.error('[Notification Service] Failed to start: ', error);
  process.exit(1);
});
