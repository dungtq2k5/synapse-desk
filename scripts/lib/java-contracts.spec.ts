import {
  GROUPS,
  constantName,
  renderAll,
  renderClass,
  unexportedPatterns,
} from './java-contracts.cjs';

/**
 * The Java contracts generator, without building anything.
 *
 * The script itself reads the BUILT `libs/common` and writes files; these rows
 * are about the decisions it makes with whatever it is handed.
 */
describe('the Java contracts generator', () => {
  const common = {
    TICKET_PATTERNS: { created: 'ticket.created', assigned: 'ticket.assigned' },
    REALTIME_EVENTS: { connectionReady: 'connection:ready' },
    CLIENT_EVENTS: { presenceUpdate: 'presence:update' },
    GRPC_CONTEXT_METADATA: { userId: 'user_id' },
  };

  describe('constantName', () => {
    it('**a dotted subject becomes a Java constant**', () => {
      expect(constantName('created')).toBe('CREATED');
      expect(constantName('connectionReady')).toBe('CONNECTION_READY');
      expect(constantName('presence:update')).toBe(
        'PRESENCE:UPDATE'.replace(':', ':'),
      );
    });
  });

  describe('renderClass', () => {
    const group = {
      className: 'Subjects',
      purpose: 'probe',
      exports: ['TICKET_PATTERNS'],
    };

    it('emits the VALUE, not the key — the string a peer compares against', () => {
      const source = renderClass(group, common);

      expect(source).toContain(
        'public static final String TICKET_CREATED = "ticket.created";',
      );
    });

    it('**is deterministic** — keys sorted, so `--check` means what it says', () => {
      const shuffled = {
        ...common,
        TICKET_PATTERNS: {
          assigned: 'ticket.assigned',
          created: 'ticket.created',
        },
      };

      expect(renderClass(group, shuffled)).toBe(renderClass(group, common));
    });

    it('**throws on an export that no longer exists** — the reverse direction', () => {
      // The registry naming something the library dropped. Caught here rather
      // than by emitting a class with a hole in it.
      expect(() =>
        renderClass({ ...group, exports: ['GONE_PATTERNS'] }, common),
      ).toThrow('GONE_PATTERNS');
    });

    it('says it is generated, so an edit is not mistaken for a source of truth', () => {
      expect(renderClass(group, common)).toContain('do not edit');
    });
  });

  describe('unexportedPatterns', () => {
    it('**a new `*_PATTERNS` family that reaches no Java class is reported**', () => {
      // The drift this generator exists to prevent, and it is invisible in the
      // OUTPUT: the files would simply not mention it.
      expect(
        unexportedPatterns({ ...common, SHINY_NEW_PATTERNS: { a: 'b' } }),
      ).toEqual(['SHINY_NEW_PATTERNS']);
    });

    it('everything the registry publishes is quiet', () => {
      expect(unexportedPatterns(common)).toEqual([]);
    });

    it('the scan looks at a real registry, not an empty one', () => {
      // A group list that emptied would report every family as covered.
      expect(GROUPS.length).toBeGreaterThanOrEqual(3);
      expect(
        GROUPS.flatMap((group) => group.exports).length,
      ).toBeGreaterThanOrEqual(10);
    });
  });

  describe('renderAll', () => {
    /** Every export the real registry declares, with one value each. */
    const complete = Object.fromEntries(
      GROUPS.flatMap((group) => group.exports).map((name) => [
        name,
        { probe: `${name.toLowerCase()}.probe` },
      ]),
    );

    it('one file per group, named for its class', () => {
      expect(Object.keys(renderAll(complete)).sort()).toEqual([
        'GrpcMetadata.java',
        'RealtimeEvents.java',
        'Subjects.java',
      ]);
    });

    it('**a group whose export is missing throws rather than emitting a hole**', () => {
      const { TICKET_PATTERNS, ...withoutTickets } = complete;

      expect(() => renderAll(withoutTickets)).toThrow('TICKET_PATTERNS');
    });
  });
});
