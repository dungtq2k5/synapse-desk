import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersController } from './users.controller';
import { UserAdminController } from './user-admin.controller';
import { UsersService } from './users.service';
import { UserServiceGrpcClient } from './users-service-grpc.client';

@Module({
  imports: [AuthModule],
  // ORDER MATTERS. Nest registers routes in this order, so `/users/me` must be
  // declared before `/users/:id` — otherwise `me` is matched as an id and
  // ParseUUIDPipe rejects the bootstrap call every SPA makes first.
  controllers: [UsersController, UserAdminController],
  providers: [UsersService, UserServiceGrpcClient],
  exports: [UsersService, UserServiceGrpcClient],
})
export class UsersModule {}
