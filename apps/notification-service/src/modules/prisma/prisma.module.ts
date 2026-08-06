import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** `@Global` like every other service's — one client, one pool. */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
