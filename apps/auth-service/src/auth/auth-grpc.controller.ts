import { Controller } from '@nestjs/common';
import {
  AuthServiceController,
  AuthServiceControllerMethods,
  RegisterRequest,
  RegisterResponse,
} from '@synapsedesk/grpc-proto';
import { AuthService } from './auth.service';

@Controller()
@AuthServiceControllerMethods()
export class AuthGrpcController implements AuthServiceController {
  constructor(private readonly authService: AuthService) {}

  register(request: RegisterRequest): Promise<RegisterResponse> {
    return this.authService.register(request);
  }
}
