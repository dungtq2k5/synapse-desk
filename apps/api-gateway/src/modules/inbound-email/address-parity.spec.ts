import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseInboundAddress,
  parseTicketReplyToken,
} from '@synapsedesk/common';

/**
 * The shared table the Java gateway's address and reply-token parsers are held to.
 *
 * Both are `libs/common`'s, and notification-service writes the same format, so
 * the Java port reproduces them byte for byte — including the lenient hex decode
 * of the MAC, which accepts `<mac>zz`. The table is checked here against the real
 * functions on every run and in Java against the port: a table nobody recomputed
 * would agree with whatever was written down.
 */
describe('the inbound address parity table', () => {
  const table = JSON.parse(
    readFileSync(
      join(
        __dirname,
        '../../../test/fixtures/inbound-email/address-parity.json',
      ),
      'utf8',
    ),
  ) as {
    address: [
      string,
      { tenantToken: string; ticketToken: string | null } | null,
    ][];
    token: [string, string, string, number | null][];
  };

  it.each(table.address)('parseInboundAddress(%j) is %j', (input, expected) => {
    expect(parseInboundAddress(input)).toEqual(expected);
  });

  it.each(table.token)(
    'parseTicketReplyToken(%j, %j, %j) is %j',
    (token, organizationId, secret, expected) => {
      expect(parseTicketReplyToken(token, organizationId, secret)).toBe(
        expected,
      );
    },
  );
});
