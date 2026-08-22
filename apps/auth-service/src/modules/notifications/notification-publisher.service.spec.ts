import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import {
  AuditAction,
  AuditPublisher,
  JetStreamPublisher,
  AuditResourceType,
  EmailTemplateName,
  NOTIFICATION_PATTERNS,
} from '@synapsedesk/common';
import { NotificationPublisher } from './notification-publisher.service';

/**
 * The publish sweep.
 *
 * Both publishers are fire-and-forget by design: they publish and never await,
 * so a slow or dead broker adds no latency to the request that triggered them.
 *
 * That design has one failure mode worth tests of its own. Publishing without
 * awaiting means the rejection has nowhere to go — a broker outage becomes an
 * unhandled rejection that takes the process down, which is precisely the
 * opposite of what "fire and forget" is supposed to buy. The old shape of this
 * bug was a cold `ClientProxy.emit()` nobody subscribed to; ADR 0041 replaced
 * the transport, and the failure survived the replacement in a new spelling,
 * which is why these tests are kept rather than retired with it.
 *
 * These are unit tests: the point is what happens when the transport fails, and
 * a real broker is the one thing that cannot be relied on to fail on cue.
 */
describe('The publish sweep (unit)', () => {
  /** A JetStreamPublisher whose `publish` does whatever the test needs. */
  function buildClient(publish: () => void) {
    return {
      publish: jest.fn(publish),
    } as unknown as jest.Mocked<JetStreamPublisher>;
  }

  describe('NotificationPublisher', () => {
    async function build(publish: () => void = () => undefined) {
      const client = buildClient(publish);
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          NotificationPublisher,
          { provide: JetStreamPublisher, useValue: client },
        ],
      }).compile();

      return { publisher: module.get(NotificationPublisher), client };
    }

    const command = {
      template: EmailTemplateName.WELCOME,
      to: 'someone@example.test',
      data: { fullName: 'Someone' },
    };

    it('publishes the command on the SUBJECT the consumer filters on', async () => {
      // A runner is bound to one `filter_subject`, so a typo here is not a
      // routing error that shows up as an exception — it is a message that
      // enters the stream and is never pulled by anybody.
      const { publisher, client } = await build();

      publisher.sendEmail(command as never);

      expect(client.publish).toHaveBeenCalledWith(
        NOTIFICATION_PATTERNS.sendEmail,
        command,
        expect.any(String),
      );
    });

    it('a BROKER failure does not propagate to the caller', () => {
      // The caller is mid-request. A registration that succeeded must not be
      // reported as failed because the welcome email could not be queued.
      // Against the REAL JetStreamPublisher, and against a SYNCHRONOUS throw:
      // `jetstream()` on a closed connection throws rather than rejecting, so a
      // publisher that only handled the promise would let this one through into
      // the request. Stubbing `JetStreamPublisher` itself would assume the
      // guarantee instead of testing it.
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      const jetstream = new JetStreamPublisher({
        jetstream: () => {
          throw new Error('connection is closed');
        },
      } as never);
      const publisher = new NotificationPublisher(jetstream);

      expect(() => publisher.sendEmail(command as never)).not.toThrow();
    });

    it('a broker failure is LOGGED — silent loss is the worse failure', async () => {
      // Fire-and-forget must not mean fire-and-never-know: this log line is the
      // only trace that a notification was dropped. Asserted on the REAL
      // `JetStreamPublisher` rather than the stub, because the catch that
      // produces it lives there.
      const error = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => {});

      const publisher = new JetStreamPublisher({
        jetstream: () => ({
          publish: () => Promise.reject(new Error('NATS is down')),
        }),
      } as never);

      publisher.publish(NOTIFICATION_PATTERNS.sendEmail, command, 'id-1');

      await new Promise((resolve) => setImmediate(resolve));
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining(NOTIFICATION_PATTERNS.sendEmail),
      );
    });

    it('does not leave an UNHANDLED rejection behind', async () => {
      // The failure that outlived the transport change. `void`-ing a promise
      // without a `.catch()` is the new spelling of subscribing without an error
      // handler: the request survives, and the process dies a tick later.
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      const unhandled = jest.fn();
      process.once('unhandledRejection', unhandled);

      const publisher = new JetStreamPublisher({
        jetstream: () => ({
          publish: () => Promise.reject(new Error('NATS is down')),
        }),
      } as never);

      publisher.publish(NOTIFICATION_PATTERNS.sendEmail, command, 'id-1');

      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).not.toHaveBeenCalled();
      process.off('unhandledRejection', unhandled);
    });
  });

  describe('AuditPublisher', () => {
    async function build(publish: () => void = () => undefined) {
      const client = buildClient(publish);
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AuditPublisher,
          { provide: JetStreamPublisher, useValue: client },
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

    it('a broker failure does not propagate to the caller', () => {
      // An audit publish that throws would roll a request back for a reason
      // that has nothing to do with whether the request succeeded.
      // Real JetStreamPublisher, synchronous throw — see the twin test above.
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      const jetstream = new JetStreamPublisher({
        jetstream: () => {
          throw new Error('connection is closed');
        },
      } as never);
      const publisher = new AuditPublisher(jetstream, {
        get: () => false,
      } as never);

      expect(() => publisher.record(context, event)).not.toThrow();
    });

    it('**mints a DISTINCT eventId per act**', async () => {
      // The consumer dedupes on `eventId`, so a publisher that reused one id
      // would make the second act a "redelivery" of the first and the consumer
      // would correctly, silently, drop it. The audit trail would lose events
      // while every component behaved exactly as designed.
      //
      // This has to be asserted at the PUBLISHER. The consumer suite builds its
      // commands by hand with a fresh uuid each time, so it can prove the
      // consumer distinguishes two ids — never that anything generates them.
      const { publisher, client } = await build();

      // The same admin performing the same act twice: identical in every field
      // except the one being tested. A content hash would collapse these, which
      // is why the id is generated rather than derived.
      publisher.record(context, event);
      publisher.record(context, event);

      const ids = client.publish.mock.calls.map(
        ([, command]) => (command as { eventId: string }).eventId,
      );
      expect(ids).toHaveLength(2);
      expect(ids[0]).toEqual(expect.any(String));
      expect(ids[0]).not.toBe(ids[1]);
    });

    it('and recordSystem does too, since it is the other way in', async () => {
      // Same property, separate entry point — and `recordSystem` builds its
      // command in its own literal rather than sharing `record`'s, so nothing
      // about one implies the other.
      const { publisher, client } = await build();

      const systemEvent = {
        ...event,
        organizationId: null,
        origin: 'auth-service/scheduler',
      };
      publisher.recordSystem(systemEvent);
      publisher.recordSystem(systemEvent);

      const ids = client.publish.mock.calls.map(
        ([, command]) => (command as { eventId: string }).eventId,
      );
      expect(ids[0]).toEqual(expect.any(String));
      expect(ids[0]).not.toBe(ids[1]);
    });

    it('derives the actor and tenant from the CONTEXT, not from the event', async () => {
      // A call site cannot record the wrong actor by passing the wrong id,
      // because there is no id to pass.
      const { publisher, client } = await build();

      publisher.record(context, event);

      const [, command] = client.publish.mock.calls[0] as [
        string,
        { userId: string; organizationId: string | null },
        string,
      ];
      expect(command.userId).toBe('actor-id');
      expect(command.organizationId).toBe('tenant-id');
    });

    it('an explicit NULL organizationId overrides the context — the platform case', async () => {
      // `!== undefined` rather than `??`: null is a MEANINGFUL override here,
      // and `??` would discard it in favour of the actor's own tenant, filing
      // a platform action inside a customer's audit trail.
      const { publisher, client } = await build();

      publisher.record(context, { ...event, organizationId: null });

      const [, command] = client.publish.mock.calls[0] as [
        string,
        { organizationId: string | null },
        string,
      ];
      expect(command.organizationId).toBeNull();
    });

    it('stamps occurredAt at EMIT time, not at consume time', async () => {
      // A consumer restart must not backdate a backlog of events to the moment
      // it caught up.
      const { publisher, client } = await build();
      const before = Date.now();

      publisher.record(context, event);

      const [, command] = client.publish.mock.calls[0] as [
        string,
        { occurredAt: string },
        string,
      ];
      expect(new Date(command.occurredAt).getTime()).toBeGreaterThanOrEqual(
        before,
      );
    });
  });

  afterEach(() => jest.restoreAllMocks());
});
