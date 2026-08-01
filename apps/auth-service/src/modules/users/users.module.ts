import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersGrpcController } from './users-grpc.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [UsersGrpcController],
  providers: [UsersService],
})
export class UsersModule {}
