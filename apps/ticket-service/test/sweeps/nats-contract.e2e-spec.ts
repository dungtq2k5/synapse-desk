import { Controller, INestApplication, Module } from '@nestjs/common';
import { waitUntil } from '@synapsedesk/common/testing/wait';
import { NestFactory } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  ClientProxy,
  ClientProxyFactory,
  EventPattern,
  MicroserviceOptions,
  Payload,
} from '@nestjs/microservices';
import { faker } from '@faker-js/faker';
import {
  createNatsTransport,
  ReassignmentReason,
  TICKET_PATTERNS,
  TicketDomainEvent,
  TicketPattern,
  TicketSource,
  TicketStatus,
  ticketMessageGroupKey,
  compareAlphabetically,
} from '@synapsedesk/common';

/** Waits for a condition rather than sleeping a fixed interval. */
/**
 * A consumer that records whatever arrives, per pattern.
 *
 * Deliberately NOT one of Domain B's real consumers. What §3.4 asks about is
 * the CONTRACT — that every variant survives the wire with no field lost — and
 * a real consumer would also apply its own logic, so a failure could be either
 * the wire or that logic. This one only remembers.
 */
const received = new Map<string, Record<string, unknown>[]>();

@Controller()
class ContractProbeConsumer {
  @EventPattern(TICKET_PATTERNS.created)
  created(@Payload() event: Record<string, unknown>) {
    this.record(TICKET_PATTERNS.created, event);
  }

  @EventPattern(TICKET_PATTERNS.escalated)
  escalated(@Payload() event: Record<string, unknown>) {
    this.record(TICKET_PATTERNS.escalated, event);
  }

  @EventPattern(TICKET_PATTERNS.assigned)
  assigned(@Payload() event: Record<string, unknown>) {
    this.record(TICKET_PATTERNS.assigned, event);
  }

  @EventPattern(TICKET_PATTERNS.reassigned)
  reassigned(@Payload() event: Record<string, unknown>) {
    this.record(TICKET_PATTERNS.reassigned, event);
  }

  @EventPattern(TICKET_PATTERNS.unassigned)
  unassigned(@Payload() event: Record<string, unknown>) {
    this.record(TICKET_PATTERNS.unassigned, event);
  }

  @EventPattern(TICKET_PATTERNS.statusChanged)
  statusChanged(@Payload() event: Record<string, unknown>) {
    this.record(TICKET_PATTERNS.statusChanged, event);
  }

  @EventPattern(TICKET_PATTERNS.messageCreated)
  messageCreated(@Payload() event: Record<string, unknown>) {
    this.record(TICKET_PATTERNS.messageCreated, event);
  }

  @EventPattern(TICKET_PATTERNS.messageUpdated)
  messageUpdated(@Payload() event: Record<string, unknown>) {
    this.record(TICKET_PATTERNS.messageUpdated, event);
  }

  @EventPattern(TICKET_PATTERNS.messageRedacted)
  messageRedacted(@Payload() event: Record<string, unknown>) {
    this.record(TICKET_PATTERNS.messageRedacted, event);
  }

  private record(pattern: string, event: Record<string, unknown>) {
    received.set(pattern, [...(received.get(pattern) ?? []), event]);
  }
}

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [ContractProbeConsumer],
})
class ProbeModule {}

/**
 * §3.4 The NATS contract sweep.
 *
 * Every `TicketDomainEvent` variant, published over a REAL broker and read back
 * by a real subscriber. The property is that nothing is lost in between.
 *
 * That is not the tautology it looks like. NATS is untyped on the wire, so the
 * compiler's guarantees stop at `emit()`: a field the publisher sets can vanish
 * to a serializer quirk, a `null` can arrive as `undefined`, a number can
 * arrive as a string, and NOTHING fails — the consumer simply reads a field
 * that is not there and behaves as though the event said something else. This
 * is the only layer where that can be caught.
 */
describe('§3.4 NATS contract sweep (e2e)', () => {
  let app: INestApplication;
  let client: ClientProxy;

  const organizationId = faker.string.uuid();
  const ticketId = faker.string.uuid();
  const occurredAt = new Date().toISOString();

  /**
   * One fully-populated instance of every variant.
   *
   * Every optional field is SET, including the ones whose null case matters:
   * an event with its optionals omitted would round-trip trivially and prove
   * nothing about the fields most likely to be dropped.
   */
  const EVENTS: TicketDomainEvent[] = [
    {
      pattern: TICKET_PATTERNS.created,
      organizationId,
      ticketId,
      occurredAt,
      ticketNumber: 4211,
      authorId: faker.string.uuid(),
      source: TicketSource.CHAT,
      title: 'Printer is on fire',
    },
    {
      pattern: TICKET_PATTERNS.escalated,
      organizationId,
      ticketId,
      ticketNumber: 4211,
      occurredAt,
      escalatedAt: occurredAt,
      departmentId: faker.string.uuid(),
    },
    {
      pattern: TICKET_PATTERNS.assigned,
      organizationId,
      ticketId,
      ticketNumber: 4211,
      occurredAt,
      assignedToId: faker.string.uuid(),
      departmentId: faker.string.uuid(),
      assignedById: faker.string.uuid(),
    },
    {
      pattern: TICKET_PATTERNS.reassigned,
      organizationId,
      ticketId,
      ticketNumber: 4211,
      occurredAt,
      fromAssigneeId: faker.string.uuid(),
      toAssigneeId: faker.string.uuid(),
      departmentId: faker.string.uuid(),
      assignedById: faker.string.uuid(),
      reason: ReassignmentReason.ESCALATION,
    },
    {
      pattern: TICKET_PATTERNS.unassigned,
      organizationId,
      ticketId,
      occurredAt,
      previousAssigneeId: faker.string.uuid(),
    },
    {
      pattern: TICKET_PATTERNS.statusChanged,
      organizationId,
      ticketId,
      ticketNumber: 4211,
      occurredAt,
      fromStatus: TicketStatus.OPEN,
      toStatus: TicketStatus.ESCALATED,
      changedById: faker.string.uuid(),
      requesterId: faker.string.uuid(),
    },
    {
      pattern: TICKET_PATTERNS.messageCreated,
      organizationId,
      ticketId,
      ticketNumber: 4211,
      occurredAt,
      messageId: faker.string.uuid(),
      senderId: faker.string.uuid(),
      requesterId: faker.string.uuid(),
      assigneeId: faker.string.uuid(),
      isAiGenerated: false,
      isInternalNote: true,
      groupKey: ticketMessageGroupKey(ticketId),
    },
    {
      pattern: TICKET_PATTERNS.messageUpdated,
      organizationId,
      ticketId,
      occurredAt,
      messageId: faker.string.uuid(),
      content: 'Actually, it is only smoking.',
      isInternalNote: true,
      editedAt: occurredAt,
    },
    {
      // **No `content` field, and the sweep is where that is pinned.** The
      // frame this becomes announces a redaction; carrying the removed words in
      // it would be the most direct way to defeat the redaction
      pattern: TICKET_PATTERNS.messageRedacted,
      organizationId,
      ticketId,
      occurredAt,
      messageId: faker.string.uuid(),
      isInternalNote: true,
      redactedAt: occurredAt,
    },
  ];

  const publish = (event: TicketDomainEvent) =>
    new Promise<void>((resolve, reject) => {
      client.emit(event.pattern, event).subscribe({
        error: (error: Error) => reject(error),
        complete: () => resolve(),
      });
    });

  const arrivalsFor = (pattern: TicketPattern) => received.get(pattern) ?? [];

  beforeAll(async () => {
    app = await NestFactory.create(ProbeModule, { logger: false });
    const configService = app.get(ConfigService);

    app.connectMicroservice<MicroserviceOptions>(
      createNatsTransport(configService),
      { inheritAppConfig: true },
    );
    await app.startAllMicroservices();
    await app.init();

    client = ClientProxyFactory.create(createNatsTransport(configService));
    await client.connect();
  }, 30_000);

  beforeEach(() => received.clear());

  afterAll(async () => {
    await client?.close();
    await app?.close();
  });

  it.each(EVENTS.map((event) => [event.pattern, event] as const))(
    '%s round-trips with EVERY field intact',
    async (pattern, event) => {
      await publish(event);

      const arrived = await waitUntil(() => arrivalsFor(pattern).length > 0);
      expect([pattern, arrived]).toEqual([pattern, true]);

      // Deep equality over the WHOLE event, not a spot-check of two fields.
      // A field silently dropped by a serializer is exactly the failure this
      // sweep exists for, and only a full comparison catches the one nobody
      // thought to assert on.
      expect(arrivalsFor(pattern)[0]).toEqual(event);
    },
  );

  it('every pattern in TICKET_PATTERNS has a probe — no variant is untested', () => {
    // Guards the sweep itself. Adding an eighth event and forgetting to add it
    // here would leave the new one unproven while this file still claimed to
    // cover "every variant".
    const covered = EVENTS.map((event) => event.pattern).sort(
      compareAlphabetically,
    );
    const declared = Object.values(TICKET_PATTERNS).sort(compareAlphabetically);

    expect(covered).toEqual(declared);
  });

  it('preserves a NULL optional as null, not as undefined or absent', async () => {
    // The case a round-trip most easily corrupts. `assignedById: null` means
    // "the system assigned it" — a real, meaningful value — and a consumer
    // reading `undefined` instead cannot tell that from a field that was never
    // sent.
    const systemAssigned: TicketDomainEvent = {
      pattern: TICKET_PATTERNS.assigned,
      organizationId,
      ticketId,
      ticketNumber: 4211,
      occurredAt,
      assignedToId: faker.string.uuid(),
      departmentId: faker.string.uuid(),
      assignedById: null,
    };

    await publish(systemAssigned);
    await waitUntil(() => arrivalsFor(TICKET_PATTERNS.assigned).length > 0);

    const arrival = arrivalsFor(TICKET_PATTERNS.assigned)[0];
    expect(arrival).toHaveProperty('assignedById', null);
    expect(arrival).toEqual(systemAssigned);
  });

  it('preserves a FALSE boolean rather than dropping it', async () => {
    // `false` is falsy, and a serializer that omitted falsy values would turn
    // "this is not an internal note" into "unspecified" — which a consumer
    // deciding who to notify would read as the opposite of what happened.
    const event: TicketDomainEvent = {
      pattern: TICKET_PATTERNS.messageCreated,
      organizationId,
      ticketId,
      ticketNumber: 4211,
      occurredAt,
      messageId: faker.string.uuid(),
      senderId: null,
      requesterId: faker.string.uuid(),
      assigneeId: null,
      isAiGenerated: true,
      isInternalNote: false,
      groupKey: ticketMessageGroupKey(ticketId),
    };

    await publish(event);
    await waitUntil(
      () => arrivalsFor(TICKET_PATTERNS.messageCreated).length > 0,
    );

    const arrival = arrivalsFor(TICKET_PATTERNS.messageCreated)[0];
    expect(arrival).toHaveProperty('isInternalNote', false);
    expect(arrival).toHaveProperty('senderId', null);
  });

  it('carries the group key BYTE-EXACT for Domain E', async () => {
    // The one field Domain B must get right FOR another domain. Domain E groups
    // notifications on string equality and cannot re-derive this later without
    // backfilling every row, so a transformation anywhere on the wire would be
    // discovered only as duplicate notifications months from now.
    const event: TicketDomainEvent = {
      pattern: TICKET_PATTERNS.messageCreated,
      organizationId,
      ticketId,
      ticketNumber: 4211,
      occurredAt,
      messageId: faker.string.uuid(),
      senderId: faker.string.uuid(),
      requesterId: faker.string.uuid(),
      assigneeId: faker.string.uuid(),
      isAiGenerated: false,
      isInternalNote: false,
      groupKey: ticketMessageGroupKey(ticketId),
    };

    await publish(event);
    await waitUntil(
      () => arrivalsFor(TICKET_PATTERNS.messageCreated).length > 0,
    );

    expect(arrivalsFor(TICKET_PATTERNS.messageCreated)[0].groupKey).toBe(
      `ticket:${ticketId}:message`,
    );
  });

  it('routes each pattern to its OWN handler, never to a sibling', async () => {
    // Seven subjects sharing a prefix. A subscription registered with a
    // wildcard, or two handlers on one pattern, would deliver an `assigned`
    // payload to the `reassigned` handler — where every field it reads is
    // missing and none of them throws.
    for (const event of EVENTS) {
      await publish(event);
    }

    await waitUntil(
      () =>
        Object.values(TICKET_PATTERNS).every(
          (pattern) => arrivalsFor(pattern).length > 0,
        ),
      10_000,
    );

    for (const pattern of Object.values(TICKET_PATTERNS)) {
      const arrivals = arrivalsFor(pattern);
      expect([pattern, arrivals.length]).toEqual([pattern, 1]);
      expect([pattern, arrivals[0].pattern]).toEqual([pattern, pattern]);
    }
  });
});
