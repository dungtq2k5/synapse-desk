import { Controller } from '@nestjs/common';
import {
  CurrentUserResponse,
  GetCurrentUserRequest,
  UserServiceController,
  UserServiceControllerMethods,
} from '@synapsedesk/grpc-proto';
import { UsersService } from './users.service';

@Controller()
@UserServiceControllerMethods()
export class UsersGrpcController implements UserServiceController {
  constructor(private readonly usersService: UsersService) {}

  getCurrentUser(request: GetCurrentUserRequest): Promise<CurrentUserResponse> {
    return this.usersService.getCurrentUser(request.userId);
  }
}
