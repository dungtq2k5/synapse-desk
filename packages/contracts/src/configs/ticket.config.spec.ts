import {
  canTransition,
  TERMINAL_TICKET_STATUSES,
  TICKET_STATUS_TRANSITIONS,
  TicketStatus,
} from './ticket.config';

/**
 * The state machine, tested where it is DEFINED.
 *
 * The plan asked for one data table that both the unit test and the e2e test import,
 * so the two can never disagree about what "legal" means. This is that table's
 * own test: the e2e suite drives the same `canTransition` against a real
 * database, and neither restates the edges.
 *
 * What is asserted here is the SHAPE of the machine — the properties a reader
 * would otherwise have to derive by eye from a nested array, and which a future
 * edit could break without any single edge looking wrong.
 */
describe('the ticket state machine (unit)', () => {
  const ALL = Object.values(TicketStatus);

  it('every status has an entry — no status is a dead lookup', () => {
    // A missing key makes `TICKET_STATUS_TRANSITIONS[from]` undefined, and a
    // naive `?includes()` on it returns false for EVERY target — silently
    // freezing tickets in that status with no error to explain it.
    for (const status of ALL) {
      expect(TICKET_STATUS_TRANSITIONS[status]).toBeDefined();
    }
  });

  it('every target is itself a real status', () => {
    // Guards against a typo in the table: `'RESOVLED'` compiles if the array is
    // ever widened, and would be permanently unreachable.
    for (const targets of Object.values(TICKET_STATUS_TRANSITIONS)) {
      for (const target of targets) {
        expect(ALL).toContain(target);
      }
    }
  });

  it('NOTHING transitions to NEW — it means "nobody has looked at this yet"', () => {
    // Which stops being true permanently. A path back to NEW would let a ticket
    // re-enter triage and lose the history of having been handled.
    for (const from of ALL) {
      expect(canTransition(from, TicketStatus.NEW)).toBe(false);
    }
  });

  it('no status transitions to ITSELF', () => {
    // A self-edge would make "change the status" a no-op that reports success,
    // and would let a client's retry look like it did something.
    for (const status of ALL) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it('every status is REACHABLE from NEW', () => {
    // A status nothing can reach is dead code in the product: it would exist in
    // the enum, in the filter dropdown and in the DTO, and no ticket could ever
    // be in it.
    const reached = new Set<TicketStatus>([TicketStatus.NEW]);
    const queue: TicketStatus[] = [TicketStatus.NEW];

    while (queue.length) {
      for (const next of TICKET_STATUS_TRANSITIONS[queue.shift()!]) {
        if (!reached.has(next)) {
          reached.add(next);
          queue.push(next);
        }
      }
    }

    expect([...reached].sort()).toEqual([...ALL].sort());
  });

  it('every TERMINAL status can still be reopened — nothing is a dead end', () => {
    // RESOLVED and CLOSED are terminal in the sense of "work finished", not
    // "immutable". A customer replying to a resolved ticket must be able to
    // reopen it, or every follow-up becomes a new ticket with no history.
    for (const terminal of TERMINAL_TICKET_STATUSES) {
      expect(canTransition(terminal, TicketStatus.OPEN)).toBe(true);
    }
  });

  it('ESCALATED cannot fall back to OPEN', () => {
    // De-escalation is a real workflow, but it is a REASSIGNMENT decision
    // rather than a status one — conflating them would let a status change
    // silently move a ticket off a tier-2 queue.
    expect(canTransition(TicketStatus.ESCALATED, TicketStatus.OPEN)).toBe(
      false,
    );
  });

  it('every status can EVENTUALLY reach a terminal one — no traps', () => {
    // Reachability, not adjacency. `NEW` deliberately cannot resolve in one
    // step: a brand-new ticket has to be triaged (NEW -> OPEN) or escalated
    // first, and letting it jump straight to RESOLVED would let work be closed
    // without anyone having looked at it.
    //
    // What must hold is the weaker, real property: from anywhere, SOME path
    // reaches a finished state. A status without one is a trap — a ticket that
    // enters it can never be completed, and nothing would report that.
    const reachesTerminal = (from: TicketStatus): boolean => {
      const seen = new Set<TicketStatus>([from]);
      const queue = [from];

      while (queue.length) {
        const current = queue.shift()!;
        for (const next of TICKET_STATUS_TRANSITIONS[current]) {
          if (TERMINAL_TICKET_STATUSES.includes(next)) return true;
          if (!seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
      return false;
    };

    for (const from of ALL) {
      expect([from, reachesTerminal(from)]).toEqual([from, true]);
    }
  });

  it('NEW cannot be resolved without triage — the one-step gap is deliberate', () => {
    // Stated explicitly so the absence above reads as a decision rather than an
    // oversight: closing a ticket nobody has read is not a workflow.
    expect(canTransition(TicketStatus.NEW, TicketStatus.RESOLVED)).toBe(false);
    expect(canTransition(TicketStatus.NEW, TicketStatus.CLOSED)).toBe(false);
  });

  it('canTransition refuses a value outside the enum rather than throwing', () => {
    // `tickets.status` is a VarChar, so a migration or a psql session can put a
    // value there the table knows nothing about. Looking it up must answer "no",
    // not crash and not permit everything.
    expect(canTransition('NONSENSE' as TicketStatus, TicketStatus.OPEN)).toBe(
      false,
    );
  });
});
