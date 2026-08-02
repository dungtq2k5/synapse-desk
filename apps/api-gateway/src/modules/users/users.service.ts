import { Injectable } from '@nestjs/common';
import { UserServiceGrpcClient } from './users-service-grpc.client';
import { RequestOrigin } from '@synapsedesk/common';
import { CurrentUserResponseDto } from './dto/rest/user-response.dto';

@Injectable()
export class UsersService {
  constructor(private readonly usersGrpcClient: UserServiceGrpcClient) {}

  getCurrentUser(
    userId: string,
    origin: RequestOrigin,
  ): Promise<CurrentUserResponseDto> {
    return this.usersGrpcClient.getCurrentUser(userId, origin);
  }
}
