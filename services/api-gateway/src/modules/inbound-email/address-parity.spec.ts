import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseInboundAddress,
  parseTicketReplyToken,
} from '@synapsedesk/common';

/**
 * A table of inputs and answers for the inbound address and reply-token parsers.
 *
 * Both are `libs/common`'s, and notification-service writes the same format, so a
 * change to either is a change to what mail reaches a ticket — including the
 * lenient hex decode of the MAC, which accepts `<mac>zz`. The table is checked
 * against the real functions on every run, so a change in behaviour is a red row
 * and a deliberate one is an edit to the table.
 */
describe('the inbound address parity table', () => {
  const table = JSON.parse(
    readFileSync(
      join(
        __dirname,
        '../../../../../test/fixtures/inbound-email/address-parity.json',
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
