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
 * `AuditConsumer` is a plain provider, not a `@Controller`. It was one while
 * `audit.record` was a core `@EventPattern` subject; ADR 0041 moved it to a
 * JetStream pull consumer, which Nest's NATS transport cannot drive — its
 * transport is core-only, so a decorated handler would never receive a durable
 * message. `main.ts` starts the runner and calls `record()` directly, which is
 * why the class is exported.
 */
@Module({
  controllers: [AuditGrpcController],
  providers: [AuditConsumer, AuditReadService],
  exports: [AuditConsumer, AuditReadService],
})
export class AuditModule {}
