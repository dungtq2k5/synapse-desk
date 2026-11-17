import { isAbandoned, PENDING_SHAPES } from './pending-sweep';

/** Known gap 35: which listed objects the sweep deletes. */
describe('An abandoned upload', () => {
  const [attachments, openings] = PENDING_SHAPES;
  const created = '2026-11-17T00:00:00.000Z';
  const at = Date.parse(created);

  const abandoned = (name: string, pattern: RegExp) =>
    isAbandoned(name, created, at + 1, pattern);

  it('is a pending/ object in exactly the position buildObjectPath puts it', () => {
    expect(
      abandoned(
        'organizations/o/tickets/t/attachments/pending/f.png',
        attachments.pattern,
      ),
    ).toBe(true);
    expect(
      abandoned(
        'organizations/o/tickets/t/attachments/pending/m/f.png',
        attachments.pattern,
      ),
    ).toBe(true);
    expect(
      abandoned(
        'organizations/o/ticket-openings/u/pending/f.png',
        openings.pattern,
      ),
    ).toBe(true);
  });

  it('is never a committed object, or pending/ anywhere else', () => {
    for (const name of [
      'organizations/o/tickets/t/attachments/f.png',
      'organizations/o/tickets/t/attachments/m/f.png',
      'organizations/o/tickets/t/pending/f.png',
      'organizations/o/documents/d/pending/f.pdf',
      'organizations/o/tickets/t/attachments/pending/m/x/f.png',
      'pending/organizations/o/tickets/t/attachments/f.png',
    ]) {
      expect([name, abandoned(name, attachments.pattern)]).toEqual([
        name,
        false,
      ]);
    }
    for (const name of [
      'organizations/o/ticket-openings/u/f.png',
      'organizations/o/ticket-openings/u/pending/x/f.png',
    ]) {
      expect([name, abandoned(name, openings.pattern)]).toEqual([name, false]);
    }
  });

  it('is older than the cutoff: one exactly at it stays', () => {
    const name = 'organizations/o/ticket-openings/u/pending/f.png';

    expect(isAbandoned(name, created, at, openings.pattern)).toBe(false);
    expect(isAbandoned(name, created, at + 1, openings.pattern)).toBe(true);
    expect(isAbandoned(name, undefined, at + 1, openings.pattern)).toBe(false);
  });
});
