import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import {
  AUTH_GRPC_CLIENT,
  AUTH_PACKAGE_NAME,
  AUTH_PROTO_PATHS,
  GRPC_CHANNEL_OPTIONS,
  GRPC_LOADER_OPTIONS,
} from '@synapsedesk/grpc-proto';
import { AuthReferenceService } from './auth-reference.service';

/**
 * ticket-service's connection BACK to auth-service.
 *
 * Needed because `tickets.author_id`, `assigned_to_id` and `department_id`
 * reference rows in a different physical database, where no foreign key can
 * reach. Validation therefore happens at WRITE time over gRPC — see
 * `AuthReferenceService`.
 *
 * The constants are imported, not redeclared: `AUTH_GRPC_CLIENT`,
 * `AUTH_PROTO_PATHS` and `GRPC_LOADER_OPTIONS` are generic despite having been
 * written for the gateway's use, and a second copy of the loader options in
 * particular would be two chances for the two ends to disagree about the wire.
 */
@Global()
@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: AUTH_GRPC_CLIENT,
        useFactory: (configService: ConfigService) => ({
          transport: Transport.GRPC,
          options: {
            package: AUTH_PACKAGE_NAME,
            protoPath: AUTH_PROTO_PATHS,
            url: configService.getOrThrow<string>('AUTH_SERVICE_URL'),
            ...GRPC_CHANNEL_OPTIONS,
            loader: GRPC_LOADER_OPTIONS,
          },
        }),
        inject: [ConfigService],
      },
    ]),
  ],
  providers: [AuthReferenceService],
  exports: [AuthReferenceService],
})
export class AuthClientModule {}
