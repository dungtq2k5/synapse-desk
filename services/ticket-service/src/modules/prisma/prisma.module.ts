import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { DatabaseSeeder } from './database.seeder';

/**
 * `@Global` for the same reason auth-service's is: every feature module needs
 * the client, and importing PrismaModule in each of them is ceremony that says
 * nothing. Reserved for genuinely cross-cutting infrastructure — see
 * the convention on not making everything global.
 */
@Global()
@Module({
  providers: [PrismaService, DatabaseSeeder],
  exports: [PrismaService, DatabaseSeeder],
})
export class PrismaModule {}
