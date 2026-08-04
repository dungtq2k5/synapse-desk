import {
  TICKET_PATTERNS,
  TicketDomainEvent,
  ticketMessageGroupKey,
} from './ticket.contract';

/**
 * The NATS contract's own unit tests.
 *
 * Almost everything here is types, which the compiler checks — so what is left
 * to test is the two things a type cannot express: the exact strings, and the
 * one derived value another domain depends on byte-for-byte.
 */
describe('ticketMessageGroupKey (unit)', () => {
  it('5. is EXACTLY `ticket:{id}:message` — the Domain E parity contract', () => {
    // Domain E's `notifications.group_key` collapses a burst of activity into
    // one notification ("3 new replies"), and grouping is exact string
    // equality. `ticket:{id}:messages` (plural) would produce a second group,
    // and Domain E cannot fix it later without backfilling every row.
    //
    // Asserted as a literal rather than by re-deriving it: a test that built
    // the expected value with the same template as the implementation would
    // pass for any template they happened to share.
    expect(ticketMessageGroupKey('abc-123')).toBe('ticket:abc-123:message');
  });

  it('5b. is singular, not plural', () => {
    // Stated separately because "message" vs "messages" is the specific typo
    // this contract exists to prevent, and a reader scanning the file should
    // see it named.
    expect(ticketMessageGroupKey('x')).not.toContain(':messages');
    expect(ticketMessageGroupKey('x').endsWith(':message')).toBe(true);
  });

  it('5c. two messages on ONE ticket share a key; two tickets do not', () => {
    // The property grouping actually depends on — that the key identifies the
    // ticket rather than the message.
    expect(ticketMessageGroupKey('same')).toBe(ticketMessageGroupKey('same'));
    expect(ticketMessageGroupKey('a')).not.toBe(ticketMessageGroupKey('b'));
  });
});

describe('TICKET_PATTERNS (unit)', () => {
  it('every subject is dot-namespaced under `ticket.`', () => {
    // NATS subjects are hierarchical: a consumer can subscribe to `ticket.*`
    // only if every one of them lives under that prefix. A stray
    // `ticket_created` would be unreachable by a wildcard subscription and
    // nothing would report it.
    for (const subject of Object.values(TICKET_PATTERNS)) {
      expect(subject).toMatch(/^ticket\.[a-z_]+$/);
    }
  });

  it('no two patterns share a subject', () => {
    const subjects = Object.values(TICKET_PATTERNS);
    expect(new Set(subjects).size).toBe(subjects.length);
  });

  it('the discriminated union covers every pattern', () => {
    // A compile-time check written as a runtime one: if a pattern is added to
    // the map without a matching union member, `event.pattern` can no longer be
    // assigned from `TICKET_PATTERNS[key]` and this fails to build.
    const patterns = Object.values(TICKET_PATTERNS);
    const covered: TicketDomainEvent['pattern'][] = patterns;

    expect(covered).toHaveLength(patterns.length);
  });
});
