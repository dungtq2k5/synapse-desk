import { Module } from '@nestjs/common';
import { AuditConsumer } from './audit.consumer';
import { AuditGrpcController } from './audit-grpc.controller';
import { AuditReadService } from './audit-read.service';

/**
 * Both ends of the trail, in one module — the NATS consumer that WRITES it and
 * the gRPC surface that READS it.
 *
 * Together on purpose: they are the only two things that touch `audit_logs`,
 * and keeping them adjacent makes the asymmetry visible. One subscribes; the
 * other has no write method at all.
 *
 * `AuditConsumer` is a `@Controller` with no HTTP routes — `@EventPattern`
 * handlers are registered by the NATS transport, and Nest discovers them the
 * same way it discovers route handlers. Declaring it under `controllers` rather
 * than `providers` is what makes that discovery happen.
 */
@Module({
  controllers: [AuditConsumer, AuditGrpcController],
  providers: [AuditReadService],
  exports: [AuditReadService],
})
export class AuditModule {}
