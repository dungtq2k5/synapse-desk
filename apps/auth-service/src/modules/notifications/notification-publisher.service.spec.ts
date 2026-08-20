import { Test, TestingModule } from '@nestjs/testing';
import { ClientProxy } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { throwError, of, Observable } from 'rxjs';
import {
  AuditAction,
  AuditPublisher,
  AuditResourceType,
  EmailTemplateName,
  NOTIFICATION_PATTERNS,
} from '@synapsedesk/common';
import { NATS_CLIENT } from '@synapsedesk/common';
import { NotificationPublisher } from './notification-publisher.service';

/**
 * the NATS emit sweep.
 *
 * Both publishers are fire-and-forget by design: they emit and never await, so
 * a slow or dead broker adds no latency to the request that triggered them.
 *
 * That design has one failure mode worth a test of its own. `ClientProxy.emit()`
 * returns a COLD observable — nothing is published until something subscribes —
 * so forgetting the `.subscribe()` is a silent no-op with no error, no message
 * and no clue. And subscribing WITHOUT an error handler turns a broker outage
 * into an unhandled rejection that takes the process down, which is precisely
 * the opposite of what "fire and forget" is supposed to buy.
 *
 * These are unit tests: the point is what happens when the transport fails, and
 * a real broker is the one thing that cannot be relied on to fail on cue.
 */
describe('NATS emit sweep (unit)', () => {
  /** A ClientProxy whose `emit` does whatever the test needs. */
  function buildClient(emit: () => Observable<unknown>) {
    return { emit: jest.fn(emit) } as unknown as jest.Mocked<ClientProxy>;
  }

  describe('NotificationPublisher', () => {
    async function build(emit: () => Observable<unknown>) {
      const client = buildClient(emit);
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          NotificationPublisher,
          { provide: NATS_CLIENT, useValue: client },
        ],
      }).compile();

      return { publisher: module.get(NotificationPublisher), client };
    }

    const command = {
      template: EmailTemplateName.WELCOME,
      to: 'someone@example.test',
      data: { fullName: 'Someone' },
    };

    it('SUBSCRIBES, because emit() is cold and would otherwise publish nothing', async () => {
      // The whole test: `emit()` returning an observable is not the same as
      // having sent anything.
      let subscribed = false;
      const { publisher, client } = await build(
        () =>
          new Observable((subscriber) => {
            subscribed = true;
            subscriber.complete();
          }),
      );

      publisher.sendEmail(command as never);

      expect(client.emit).toHaveBeenCalledWith(
        NOTIFICATION_PATTERNS.sendEmail,
        command,
      );
      expect(subscribed).toBe(true);
    });

    it('a BROKER failure does not propagate to the caller', async () => {
      // The caller is mid-request. A registration that succeeded must not be
      // reported as failed because the welcome email could not be queued.
      const { publisher } = await build(() =>
        throwError(() => new Error('NATS is down')),
      );
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      expect(() => publisher.sendEmail(command as never)).not.toThrow();
    });

    it('a broker failure is LOGGED — silent loss is the worse failure', async () => {
      // Fire-and-forget must not mean fire-and-never-know: this log line is the
      // only trace that a notification was dropped.
      const error = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => {});

      const { publisher } = await build(() =>
        throwError(() => new Error('NATS is down')),
      );
      publisher.sendEmail(command as never);

      expect(error).toHaveBeenCalledWith(
        expect.stringContaining(NOTIFICATION_PATTERNS.sendEmail),
      );
    });

    it('does not leave an UNHANDLED rejection behind', async () => {
      // Subscribing without an error handler is the other way to get this
      // wrong: the request survives, and the process dies a tick later.
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      const unhandled = jest.fn();
      process.once('unhandledRejection', unhandled);

      const { publisher } = await build(() =>
        throwError(() => new Error('NATS is down')),
      );
      publisher.sendEmail(command as never);

      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).not.toHaveBeenCalled();
      process.off('unhandledRejection', unhandled);
    });
  });

  describe('AuditPublisher', () => {
    async function build(emit: () => Observable<unknown>) {
      const client = buildClient(emit);
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AuditPublisher,
          { provide: NATS_CLIENT, useValue: client },
          {
            provide: ConfigService,
            useValue: { get: jest.fn().mockReturnValue(false) },
          },
        ],
      }).compile();

      return { publisher: module.get(AuditPublisher), client };
    }

    const context = {
      ip: '203.0.113.1',
      userAgent: 'jest',
      sub: 'actor-id',
      organizationId: 'tenant-id',
      isSuperAdmin: false,
      departmentIds: [],
      permissionCodes: [],
      isEmailVerified: true,
    };

    const event = {
      action: AuditAction.PASSWORD_CHANGED,
      resourceType: AuditResourceType.USER,
      resourceId: 'target-id',
    };

    it('a broker failure does not propagate to the caller', async () => {
      // An audit publish that throws would roll a request back for a reason
      // that has nothing to do with whether the request succeeded.
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      const { publisher } = await build(() =>
        throwError(() => new Error('NATS is down')),
      );

      expect(() => publisher.record(context, event)).not.toThrow();
    });

    it('derives the actor and tenant from the CONTEXT, not from the event', async () => {
      // A call site cannot record the wrong actor by passing the wrong id,
      // because there is no id to pass.
      const { publisher, client } = await build(() => of(undefined));

      publisher.record(context, event);

      const [, command] = client.emit.mock.calls[0] as [
        string,
        { userId: string; organizationId: string | null },
      ];
      expect(command.userId).toBe('actor-id');
      expect(command.organizationId).toBe('tenant-id');
    });

    it('an explicit NULL organizationId overrides the context — the platform case', async () => {
      // `!== undefined` rather than `??`: null is a MEANINGFUL override here,
      // and `??` would discard it in favour of the actor's own tenant, filing
      // a platform action inside a customer's audit trail.
      const { publisher, client } = await build(() => of(undefined));

      publisher.record(context, { ...event, organizationId: null });

      const [, command] = client.emit.mock.calls[0] as [
        string,
        { organizationId: string | null },
      ];
      expect(command.organizationId).toBeNull();
    });

    it('stamps occurredAt at EMIT time, not at consume time', async () => {
      // A consumer restart must not backdate a backlog of events to the moment
      // it caught up.
      const { publisher, client } = await build(() => of(undefined));
      const before = Date.now();

      publisher.record(context, event);

      const [, command] = client.emit.mock.calls[0] as [
        string,
        { occurredAt: string },
      ];
      expect(new Date(command.occurredAt).getTime()).toBeGreaterThanOrEqual(
        before,
      );
    });
  });

  afterEach(() => jest.restoreAllMocks());
});
