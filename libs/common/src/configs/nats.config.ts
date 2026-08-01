import { ConfigService } from '@nestjs/config';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';

export function createNatsTransport(
  configService: ConfigService,
): MicroserviceOptions {
  return {
    transport: Transport.NATS,
    options: {
      servers: [configService.getOrThrow<string>('NATS_URL')],
      serializer: {
        serialize: (value: any) => Buffer.from(JSON.stringify(value)),
        deserialize: (value: Buffer) => JSON.parse(value.toString()) as unknown,
      },
    },
  };
}
