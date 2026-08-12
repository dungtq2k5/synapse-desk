import {
  buildInboundAddress,
  buildTicketReplyToken,
  generateInboundToken,
  MAX_ADDRESSABLE_TICKET_NUMBER,
  parseInboundAddress,
  parseTicketReplyToken,
} from './inbound-email.config';

/**
 * The address format — 31-doc §2, §4.
 *
 * Every test here is about a way mail gets misrouted or silently dropped, which
 * is why the negative cases outnumber the positive ones: an address that fails
 * to parse costs one email, and an address that parses to the WRONG tenant puts
 * one company's support request in another company's queue.
 */
describe('inbound email addressing', () => {
  const DOMAIN = 'inbound.synapsedesk.test';
  const TENANT = 'a'.repeat(32);
  const TICKET = 'deadbeef';

  describe('the tenant token', () => {
    it('**is 32 lowercase hex characters** — it has to fit VarChar(32)', () => {
      const token = generateInboundToken();

      expect(token).toMatch(/^[0-9a-f]{32}$/);
      expect(token).toHaveLength(32);
    });

    it('**and survives a mail hop that lowercases the address**', () => {
      // The reason this is not `generateSecureToken()`. That helper is
      // `base64url` — case-sensitive — and local-part case is normalised by
      // plenty of real mail systems, so one such hop would unroute the tenant
      // permanently and look exactly like nobody emailing them.
      const token = generateInboundToken();

      expect(token.toLowerCase()).toBe(token);
    });

    it('is unguessable from another tenant’s', () => {
      // Not a strength proof — a smoke test that it is random at all. A
      // sequential or slug-derived token makes the tenant list enumerable,
      // which is the entire reason the column is not the slug.
      const tokens = new Set(
        Array.from({ length: 50 }, () => generateInboundToken()),
      );

      expect(tokens.size).toBe(50);
    });
  });

  describe('parsing', () => {
    it('finds the tenant in a plain support address', () => {
      expect(parseInboundAddress(`support+${TENANT}@${DOMAIN}`)).toEqual({
        tenantToken: TENANT,
        ticketToken: null,
      });
    });

    it('finds the ticket token in a reply address', () => {
      expect(
        parseInboundAddress(`support+${TENANT}.${TICKET}@${DOMAIN}`),
      ).toEqual({ tenantToken: TENANT, ticketToken: TICKET });
    });

    it('**normalises case, because a hop may have changed it**', () => {
      expect(
        parseInboundAddress(`SUPPORT+${TENANT.toUpperCase()}@${DOMAIN}`),
      ).toEqual({ tenantToken: TENANT, ticketToken: null });
    });

    it.each([
      ['no plus segment', `support@${DOMAIN}`],
      ['a different local part', `sales+${TENANT}@${DOMAIN}`],
      ['a token of the wrong length', `support+abc@${DOMAIN}`],
      ['a non-hex token', `support+${'z'.repeat(32)}@${DOMAIN}`],
      ['an empty token', `support+@${DOMAIN}`],
    ])('refuses %s', (_, address) => {
      expect(parseInboundAddress(address)).toBeNull();
    });

    it('**refuses a third segment rather than ignoring it**', () => {
      // Accepting a prefix would make `support+{tenant}.{ticket}.anything`
      // route to the tenant, so one tenant would answer at unboundedly many
      // addresses — the enumeration the opaque token exists to prevent.
      expect(
        parseInboundAddress(`support+${TENANT}.${TICKET}.extra@${DOMAIN}`),
      ).toBeNull();
    });

    it('and tolerates a missing domain, since only the local part matters', () => {
      expect(parseInboundAddress(`support+${TENANT}`)).toEqual({
        tenantToken: TENANT,
        ticketToken: null,
      });
    });
  });

  describe('building', () => {
    it('round-trips both forms', () => {
      const plain = buildInboundAddress(DOMAIN, TENANT);
      const reply = buildInboundAddress(DOMAIN, TENANT, TICKET);

      expect(parseInboundAddress(plain)).toEqual({
        tenantToken: TENANT,
        ticketToken: null,
      });
      expect(parseInboundAddress(reply)).toEqual({
        tenantToken: TENANT,
        ticketToken: TICKET,
      });
    });

    it('**and what it builds is what a real token produces**', () => {
      // Guards the pair together: a builder and a parser that agree on a
      // hand-written literal can still both be wrong about the real generator.
      const token = generateInboundToken();

      expect(parseInboundAddress(buildInboundAddress(DOMAIN, token))).toEqual({
        tenantToken: token,
        ticketToken: null,
      });
    });
  });

  /**
   * 32-doc §4.4 test 7 — **a forged ticket token must not thread.**
   *
   * The one to write first. Everything else in this feature fails visibly; a
   * weak reply token lets one customer read and write another's support thread
   * by editing an address, and the failure looks like ordinary email working.
   */
  describe('the reply token', () => {
    const SECRET = 'inbound-signing-secret';
    const ORG = 'f'.repeat(32);
    const OTHER_ORG = 'e'.repeat(32);

    it('round-trips the ticket number it was minted for', () => {
      const token = buildTicketReplyToken(ORG, 4211, SECRET);

      expect(parseTicketReplyToken(token, ORG, SECRET)).toBe(4211);
    });

    it('**an altered MAC is refused**', () => {
      const token = buildTicketReplyToken(ORG, 4211, SECRET);
      const [number, mac] = token.split('-');
      const flipped = `${number}-${mac.slice(0, -1)}${mac.endsWith('0') ? '1' : '0'}`;

      expect(parseTicketReplyToken(flipped, ORG, SECRET)).toBeNull();
    });

    it('**an altered ticket NUMBER is refused** — the interesting forgery', () => {
      // Editing the number is the attack a reader would actually try: the
      // address is in their inbox, the number is legible, and neighbouring
      // tickets belong to other customers.
      const token = buildTicketReplyToken(ORG, 4211, SECRET);
      const mac = token.split('-')[1];

      expect(
        parseTicketReplyToken(`${(4212).toString(36)}-${mac}`, ORG, SECRET),
      ).toBeNull();
    });

    it('**a token from ANOTHER tenant does not verify** — numbers repeat', () => {
      // Ticket numbers are per-tenant, so tenant A's #4211 and tenant B's #4211
      // both exist. Without the tenant inside the MAC, A's reply address would
      // thread onto B's ticket.
      const token = buildTicketReplyToken(OTHER_ORG, 4211, SECRET);

      expect(parseTicketReplyToken(token, ORG, SECRET)).toBeNull();
    });

    it('and a token signed with a different secret does not verify', () => {
      const token = buildTicketReplyToken(ORG, 4211, 'some-other-secret');

      expect(parseTicketReplyToken(token, ORG, SECRET)).toBeNull();
    });

    it.each([
      ['no separator', 'deadbeef'],
      ['an empty MAC', '38b-'],
      ['an empty number', '-abcdef123456'],
      ['a non-base36 number', '!!-abcdef123456'],
      ['a third segment', '38b-abcdef123456-x'],
      ['a MAC of the wrong length', '38b-abc'],
    ])('refuses %s', (_, token) => {
      expect(parseTicketReplyToken(token, ORG, SECRET)).toBeNull();
    });

    it('**refuses a number `parseInt` would silently truncate**', () => {
      // `parseInt('12x', 36)` stops at the invalid character and returns a
      // number — which would then be MAC-checked against a value nobody issued
      // for it, and, far worse, would let two spellings of one number exist.
      const token = buildTicketReplyToken(ORG, 42, SECRET);
      const mac = token.split('-')[1];

      expect(
        parseTicketReplyToken(`${(42).toString(36)}x-${mac}`, ORG, SECRET),
      ).toBeNull();
    });

    it('**fits inside RFC 5321’s 64-octet local part, at the stated ceiling**', () => {
      // `support+` + 32-char tenant token + `.` + the reply token. Exceeding it
      // is not a validation error anywhere in this codebase — it is mail some
      // MTAs refuse, which reads as replies mysteriously failing to thread for
      // one tenant.
      //
      // Asserted at `MAX_ADDRESSABLE_TICKET_NUMBER` rather than at
      // `MAX_SAFE_INTEGER`: `ticket_number` is a `bigserial`, so there is no
      // small type bound to lean on, and the first version of this test failed
      // at 65 characters for exactly that reason. The constant is the budget,
      // and this is what holds it to it.
      const address = buildInboundAddress(
        DOMAIN,
        generateInboundToken(),
        buildTicketReplyToken(ORG, MAX_ADDRESSABLE_TICKET_NUMBER, SECRET),
      );

      expect(address.slice(0, address.indexOf('@')).length).toBeLessThanOrEqual(
        64,
      );
    });

    it('and the ceiling still round-trips', () => {
      const token = buildTicketReplyToken(
        ORG,
        MAX_ADDRESSABLE_TICKET_NUMBER,
        SECRET,
      );

      expect(parseTicketReplyToken(token, ORG, SECRET)).toBe(
        MAX_ADDRESSABLE_TICKET_NUMBER,
      );
    });
  });
});
