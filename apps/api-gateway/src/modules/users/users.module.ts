import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { UserServiceGrpcClient } from './users-service-grpc.client';

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService, UserServiceGrpcClient],
  exports: [UsersService, UserServiceGrpcClient],
})
export class UsersModule {}
