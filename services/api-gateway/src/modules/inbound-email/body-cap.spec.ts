import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_INBOUND_BODY_LENGTH } from '../../common/config/dto.config';
import { toStoredBody } from './quoted-reply';
import { capBody, toMappedInboundEmail } from './resend-inbound.mapper';

type Piece = [string, number];
type Row = [
  Piece[] | null,
  { length: number; tail: string; truncated: boolean } | null,
];

/**
 * The inbound body cap: the shared table, the mapper's use of it, and the
 * property it exists for.
 *
 * The cap is applied where the fetched mail enters, because the patterns that
 * strip quoted history and HTML are quadratic on a body of unclosed tags.
 */
describe('the inbound body cap', () => {
  const table = JSON.parse(
    readFileSync(
      join(
        __dirname,
        '../../../../../test/fixtures/inbound-email/body-cap-parity.json',
      ),
      'utf8',
    ),
  ) as { max: number; rows: Row[] };

  const build = (pieces: Piece[] | null): string | null =>
    pieces === null ? null : pieces.map(([s, n]) => s.repeat(n)).join('');

  it('**the table was computed for this constant**', () => {
    // A regenerated table against a moved cap would compare nothing.
    expect(table.max).toBe(MAX_INBOUND_BODY_LENGTH);
  });

  it.each(table.rows.map((row, index) => [index, ...row] as const))(
    'row %i is cut the way the table says',
    (_index, pieces, expected) => {
      const result = capBody(build(pieces));

      if (expected === null) {
        expect(result).toEqual({ value: null, truncated: false });

        return;
      }
      expect(result.value?.length).toBe(expected.length);
      expect(result.value?.slice(-4)).toBe(expected.tail);
      expect(result.truncated).toBe(expected.truncated);
    },
  );

  it('**never splits a surrogate pair**, so the cut never tears a character in two', () => {
    for (const [pieces] of table.rows) {
      const input = build(pieces) ?? '';
      const value = capBody(input).value ?? '';
      if (value.length === input.length) continue;

      // A cut that left a high surrogate behind with its low half as the very
      // next character would have torn an astral character apart. (A lone high
      // surrogate the INPUT already had at the cut is not that.)
      const last = value.charCodeAt(value.length - 1);
      const next = input.charCodeAt(value.length);
      const tore =
        last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;

      expect(tore).toBe(false);
    }
  });

  describe('through the mapper', () => {
    const event = { created_at: '2026-10-01T09:00:00.000Z', data: {} };
    const mail = (text: string | null, html: string | null) =>
      ({
        from: 'customer@acme.test',
        subject: 'Help',
        text,
        html,
        received_for: ['support@inbound.test'],
        headers: {},
        attachments: [],
      }) as never;

    it('caps both parts and says so', () => {
      const { fields } = toMappedInboundEmail(
        event as never,
        mail(
          't'.repeat(MAX_INBOUND_BODY_LENGTH + 1),
          'h'.repeat(MAX_INBOUND_BODY_LENGTH),
        ),
        'inbound.test',
      );

      expect(fields.text).toHaveLength(MAX_INBOUND_BODY_LENGTH);
      expect(fields.html).toHaveLength(MAX_INBOUND_BODY_LENGTH);
      expect(fields.bodyTruncated).toBe(true);
    });

    it('says nothing when the body fits — and reads a body at the limit whole', () => {
      const { fields } = toMappedInboundEmail(
        event as never,
        mail('t'.repeat(MAX_INBOUND_BODY_LENGTH), null),
        'inbound.test',
      );

      expect(fields.text).toHaveLength(MAX_INBOUND_BODY_LENGTH);
      expect(fields.html).toBeNull();
      expect(fields.bodyTruncated).toBe(false);
    });

    it('**flags a body cut in either part alone**', () => {
      const htmlOnly = toMappedInboundEmail(
        event as never,
        mail(null, 'h'.repeat(MAX_INBOUND_BODY_LENGTH + 1)),
        'inbound.test',
      );

      expect(htmlOnly.fields.bodyTruncated).toBe(true);
      expect(htmlOnly.fields.text).toBeNull();
    });
  });

  it('**a hostile body is processed in bounded time**, however large the mail', () => {
    // 600 000 characters of unclosed tags is ~35 s of the quoted-reply patterns
    // uncapped. Capped at the mapper, the worst is about half a second.
    const hostile = '<p>' + '<div '.repeat(120_000);
    const { fields } = toMappedInboundEmail(
      { created_at: '2026-10-01T09:00:00.000Z', data: {} } as never,
      {
        from: 'a@b.test',
        subject: 's',
        text: null,
        html: hostile,
        received_for: ['support@inbound.test'],
        headers: {},
        attachments: [],
      } as never,
      'inbound.test',
    );

    const started = Date.now();
    toStoredBody(fields.text, fields.html);

    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
