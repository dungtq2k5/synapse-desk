import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PlatformUsageService } from './platform.service';
import { PlatformGrpcController } from './platform-grpc.controller';

/**
 * The cross-tenant read surface, kept in its own module so the boundary is a
 * file boundary rather than a convention.
 */
@Module({
  imports: [PrismaModule],
  controllers: [PlatformGrpcController],
  providers: [PlatformUsageService],
})
export class PlatformModule {}
