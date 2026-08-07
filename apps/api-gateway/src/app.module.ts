import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigService, ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { getThrottlerConfig } from './common/config/throttler.config';
import { SmartThrottlerGuard } from './common/guards/smart-throttler.guard';
import { OrganizationStatusInterceptor } from './common/interceptors/organization-status.interceptor';
import { OrganizationStatusModule } from './common/services/organization-status.module';
import { AuthModule } from './modules/auth/auth.module';
import { envValidationSchema } from './common/config/env.validation';
import { UsersModule } from './modules/users/users.module';
import { OtpModule } from './modules/otp/otp.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { HealthModule } from './modules/health/health.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { RolesModule } from './modules/roles/roles.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { PlatformModule } from './modules/platform/platform.module';
import { PlatformJobsModule } from './modules/platform-jobs/platform-jobs.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { ChatModule } from './modules/chat/chat.module';
import { FeedbackModule } from './modules/feedback/feedback.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { BillingModule } from './modules/billing/billing.module';
import { TicketGrpcModule } from './common/grpc/ticket-grpc.module';
import { IngestionGrpcModule } from './common/grpc/ingestion-grpc.module';
import { RagGrpcModule } from './common/grpc/rag-grpc.module';
import { NotificationGrpcModule } from './common/grpc/notification-grpc.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // Makes ConfigService available globally
      validationSchema: envValidationSchema,
      validationOptions: {
        allowUnknown: true, // Ignore env variables that are not defined in the validation schema
      },
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: getThrottlerConfig,
    }),

    OrganizationStatusModule,
    // The single channel to ticket-service, global because Domain B's surface
    // will span several gateway modules and all of them must share one.
    //
    // Not a feature module for the same reason a Domain B feature module
    // doesn't exist yet: `realtime` is A consumer, not THE consumer — the
    // TICKET_PROTO_PATHS surface already covers six services (ticket,
    // assignment, message, ai, feedback, audit), and only one of them
    // (`TicketAccessService`, used by `realtime`) has a caller so far. Owning
    // the registration inside `realtime` would work today but misname the
    // relationship: the day a REST ticket module needs the same channel, it
    // would import a module called "realtime" for a connection that has
    // nothing to do with sockets.
    //
    // This is not actually different from AuthModule's pattern, just viewed
    // from a different angle: AuthModule ALSO separates the ClientsModule
    // registration from most of its consumers (OtpModule, DepartmentsModule,
    // etc. all import AuthModule from elsewhere to reach AUTH_GRPC_CLIENT). The
    // one difference is that Auth has a natural first home (`modules/auth`) to
    // register from; Ticket does not yet, so the registration lives in
    // `common/grpc/` alongside `base-grpc.client.ts` — the other thing here
    // that isn't owned by one feature.
    TicketGrpcModule,
    IngestionGrpcModule,
    RagGrpcModule,
    NotificationGrpcModule,
    AuthModule,

    // ORDER MATTERS for everything mounted under /users.
    //
    // Nest matches routes in REGISTRATION order, and registration order is
    // module import order. `UserAdminController` declares `/users/:id`, which
    // matches `/users/invitations` and `/users/<uuid>/sessions` equally well —
    // so any module owning a LITERAL segment under /users must be imported
    // before UsersModule, or its routes are swallowed and ParseUUIDPipe turns
    // them into a 400 that looks like a client bug.
    //
    // This is not hypothetical: adding `/users/:id` broke `GET
    // /users/invitations` until these two lines were swapped.
    InvitationsModule,
    SessionsModule,
    UsersModule,

    OtpModule,
    DepartmentsModule,
    RolesModule,
    OrganizationsModule,
    PlatformModule,
    PlatformJobsModule,
    TicketsModule,
    ChatModule,
    FeedbackModule,
    AuditLogsModule,
    DocumentsModule,
    NotificationsModule,
    AnalyticsModule,
    KnowledgeModule,
    BillingModule,
    RealtimeModule,
    HealthModule,
  ],
  providers: [
    // Global, so a route added later is rate-limited by DEFAULT. Registering it
    // per-controller would mean the one someone forgets is the one with no
    // limit — and that is reliably the interesting one.
    { provide: APP_GUARD, useClass: SmartThrottlerGuard },
    // An INTERCEPTOR, not a guard: global guards run before route-level ones,
    // so this would execute before JwtAuthGuard had resolved the caller and
    // would have no tenant to gate on. Interceptors run after every guard.
    { provide: APP_INTERCEPTOR, useClass: OrganizationStatusInterceptor },
  ],
})
export class AppModule {}
