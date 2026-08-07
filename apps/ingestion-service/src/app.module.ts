import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envValidationSchema } from './common/configs/env.validation';
import { PrismaModule } from './modules/prisma/prisma.module';
import { EventsModule } from './modules/events/events.module';
import { AuthClientModule } from './modules/auth-client/auth-client.module';
import { StorageClientModule } from './modules/storage-client/storage-client.module';
import { AiLedgerModule } from './modules/ai-ledger/ai-ledger.module';
import { AiSettingsModule } from './modules/ai-settings/ai-settings.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { IngestionModule } from './modules/ingestion/ingestion.module';
import { ScheduledModule } from './modules/scheduled/scheduled.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: { allowUnknown: true },
    }),
    PrismaModule,
    EventsModule,
    AuthClientModule,
    StorageClientModule,
    AiLedgerModule,
    AiSettingsModule,
    DocumentsModule,
    IngestionModule,
    ScheduledModule,
    SchedulerModule,
  ],
})
export class AppModule {}
