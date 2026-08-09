import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envValidationSchema } from './common/configs/env.validation';
import { PrismaModule } from './modules/prisma/prisma.module';
import { EventsModule } from './modules/events/events.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthClientModule } from './modules/auth-client/auth-client.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
import { AssignmentsModule } from './modules/assignments/assignments.module';
import { MessagesModule } from './modules/messages/messages.module';
import { AiModule } from './modules/ai/ai.module';
import { FeedbackModule } from './modules/feedback/feedback.module';
import { OpsModule } from './modules/ops/ops.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: {
        allowUnknown: true, // Ignore env vars not declared in the schema
      },
    }),
    PrismaModule,
    EventsModule,
    AuthClientModule,
    AuditModule,
    TicketsModule,
    // The read projection over Domain B — 19-doc. No `analytics-service`
    // exists; analytics lives beside the data it reads and the gateway
    // composes across services.
    AnalyticsModule,
    SchedulerModule,
    AssignmentsModule,
    MessagesModule,
    AiModule,
    FeedbackModule,
    OpsModule,
  ],
})
export class AppModule {}
