import { Injectable } from '@nestjs/common';
import { RegisterDto } from '../auth/dto/rest/register.dto';
import { RegisterResponseDto } from '../auth/dto/rest/register-response.dto';
import { AuthServiceGrpcClient } from './auth-service-grpc.client';

@Injectable()
export class AuthService {
  constructor(private readonly authGrpcClient: AuthServiceGrpcClient) {}

  register(registerRequest: RegisterDto): Promise<RegisterResponseDto> {
    return this.authGrpcClient.register(registerRequest);
  }
}
