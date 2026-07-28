import {
  GatewayTimeoutException,
  Inject,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  AUTH_GRPC_CLIENT,
  AUTH_SERVICE_NAME,
  AuthServiceClient,
} from '@synapsedesk/grpc-proto';
import {
  catchError,
  firstValueFrom,
  throwError,
  timeout,
  TimeoutError,
} from 'rxjs';
import { RegisterDto } from './dto/rest/register.dto';
import { RegisterResponseDto } from './dto/rest/register-response.dto';

/** A gRPC call with no deadline hangs forever if the peer stops responding. */
const GRPC_DEADLINE_MS = 5_000;

/**
 * Transport adapter for auth-service.
 *
 * This is the ONLY file in the gateway allowed to import from
 * `@synapsedesk/grpc-proto`. It takes gateway DTOs in and returns gateway DTOs
 * out, so a rename inside auth.proto surfaces as a compile error here rather
 * than silently changing the public REST contract.
 */
@Injectable()
export class AuthServiceGrpcClient implements OnModuleInit {
  private authGrpcService!: AuthServiceClient;

  constructor(@Inject(AUTH_GRPC_CLIENT) private readonly client: ClientGrpc) {}

  onModuleInit() {
    this.authGrpcService =
      this.client.getService<AuthServiceClient>(AUTH_SERVICE_NAME);
  }

  async register(registerDto: RegisterDto): Promise<RegisterResponseDto> {
    const response = await firstValueFrom(
      this.authGrpcService
        .register({
          email: registerDto.email,
          password: registerDto.password,
          fullName: registerDto.fullName,
        })
        // ASK Is there a way to globalize this? In auth.module.ts?
        .pipe(
          timeout(GRPC_DEADLINE_MS),
          catchError((error: unknown) =>
            throwError(() =>
              error instanceof TimeoutError
                ? new GatewayTimeoutException(
                    'auth-service did not respond in time',
                  )
                : error,
            ),
          ),
        ),
    );

    return {
      userId: response.userId,
      organizationId: response.organizationId,
      email: response.email,
      requiresEmailVerification: response.requiresEmailVerification,
    };
  }
}
