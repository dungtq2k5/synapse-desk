import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 1. Connect gRPC Server for Synchronous RPC Calls
  // app.connectMicroservice<MicroserviceOptions>({
  //   transport: Transport.GRPC,
  //   options: {
  //     package: TICKET_PACKAGE_NAME,
  //     protoPath: TICKET_PROTO_PATH,
  //     url: process.env.GRPC_URL || '0.0.0.0:50051',
  //   },
  // });

  // 2. Connect NATS Transporter for Asynchronous Event Streaming
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.NATS,
    options: {
      servers: [process.env.NATS_URL || 'nats://localhost:4222'],
      queue: 'ticket_service_queue',
    },
  });

  await app.startAllMicroservices();
  console.log(
    '🚀 [Ticket Service] gRPC listening on :50051 | NATS subscriber active',
  );
}
bootstrap();
