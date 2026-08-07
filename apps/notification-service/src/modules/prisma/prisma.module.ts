import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { DatabaseSeeder } from './database.seeder';

/** `@Global` like every other service's — one client, one pool. */
@Global()
@Module({
  providers: [PrismaService, DatabaseSeeder],
  // The seeder is exported so the e2e fixture can call `seed()` explicitly
  // rather than depending on `SEED_ON_BOOTSTRAP` being true in tests — the
  // same arrangement ingestion-service uses, and for the same reason: two
  // seeding paths eventually disagree about which indexes exist.
  exports: [PrismaService, DatabaseSeeder],
})
export class PrismaModule {}
