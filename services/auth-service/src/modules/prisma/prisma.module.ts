import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { DatabaseSeeder } from './database.seeder';

@Module({
  // DatabaseSeeder is intentionally not exported: it runs itself once via
  // OnApplicationBootstrap and nothing else should be invoking it.
  providers: [PrismaService, DatabaseSeeder],
  exports: [PrismaService],
})
export class PrismaModule {}
