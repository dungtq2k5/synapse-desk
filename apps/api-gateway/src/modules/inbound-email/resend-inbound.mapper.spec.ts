import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type {
  EmailReceivedEvent,
  GetReceivingEmailResponseSuccess,
} from 'resend';
import { VALIDATION_PIPE_OPTIONS } from '../../common/config/validation.config';
import { InboundEmailDto } from './dto/rest/inbound-email.dto';
import {
  toMappedInboundEmail,
  UNNAMED_ATTACHMENT,
} from './resend-inbound.mapper';

/**
 * Resend's two objects → the mail `accept()` takes.
 *
 * **Hand-built, not captured** — no inbound mail has been received on a real
 * account yet, so these follow the SDK's types (`resend@6.28.0`). Replace them
 * with a recorded `email.received` event and `receiving.get` response when one
 * exists; a recorded shape can disagree with the mapper, which is the point.
 *
 * Built independently of the e2e fixture helper, which is this mapper's
 * inverse: a bug mirrored in both would pass every e2e test.
 */
describe('toMappedInboundEmail', () => {
  const DOMAIN = 'inbound.synapsedesk.test';
  const TENANT = `support+a1b2c3d4e5f60718293a4b5c6d7e8f90@${DOMAIN}`;

  const event = (
    overrides: Partial<EmailReceivedEvent['data']> = {},
  ): EmailReceivedEvent => ({
    type: 'email.received',
    created_at: '2026-09-15T10:00:00.000Z',
    data: {
      email_id: 'e-1',
      created_at: '2026-09-15T10:00:00.000Z',
      from: 'Ada Lovelace <ada@acme.test>',
      to: [TENANT],
      cc: [],
      bcc: [],
      received_for: [TENANT],
      message_id: '<m-1@acme.test>',
      subject: 'Printer',
      attachments: [],
      ...overrides,
    },
  });

  const email = (
    overrides: Partial<GetReceivingEmailResponseSuccess> = {},
  ): GetReceivingEmailResponseSuccess => ({
    object: 'email',
    id: 'e-1',
    to: [TENANT],
    from: 'Ada Lovelace <ada@acme.test>',
    created_at: '2026-09-15T10:00:00.000Z',
    subject: 'Printer',
    bcc: null,
    cc: null,
    reply_to: null,
    received_for: [TENANT],
    html: null,
    text: 'It is on fire.',
    headers: {},
    message_id: '<m-1@acme.test>',
    attachments: [],
    ...overrides,
  });

  const map = (mail = email(), received = event()) =>
    toMappedInboundEmail(received, mail, DOMAIN);

  describe('the recipient', () => {
    it('**comes from `received_for`, not the `To:` header**', () => {
      // A mail that reached the tenant address by BCC or through a list names
      // somebody else in `To:`; only the envelope says it was for us.
      const { fields } = map(
        email({ to: ['everyone@lists.acme.test'], received_for: [TENANT] }),
      );

      expect(fields.to).toBe(TENANT);
    });

    it('**no entry on the inbound domain → `""`, which nothing routes**', () => {
      // `parseInboundAddress` ignores the domain, so passing the foreign address
      // through would route `support+token@elsewhere` to the tenant.
      const { fields, tenantRecipientCount } = map(
        email({
          received_for: [
            'support+a1b2c3d4e5f60718293a4b5c6d7e8f90@elsewhere.test',
          ],
        }),
      );

      expect(fields.to).toBe('');
      expect(tenantRecipientCount).toBe(0);
    });

    it('two tenant addresses → the first, and the count says two', () => {
      const second = `support+ffffffffffffffffffffffffffffffff@${DOMAIN}`;
      const { fields, tenantRecipientCount } = map(
        email({ received_for: ['someone@acme.test', TENANT, second] }),
      );

      expect(fields.to).toBe(TENANT);
      expect(tenantRecipientCount).toBe(2);
    });

    it('matches the domain case-insensitively and takes a bracketed entry', () => {
      const { fields } = map(
        email({ received_for: [`Support <${TENANT.toUpperCase()}>`] }),
      );

      expect(fields.to).toBe(TENANT);
    });
  });

  describe('the sender', () => {
    it.each([
      ['Ada Lovelace <ada@acme.test>', 'ada@acme.test', 'Ada Lovelace'],
      ['"Lovelace, Ada" <ada@acme.test>', 'ada@acme.test', 'Lovelace, Ada'],
      ['ada@acme.test', 'ada@acme.test', undefined],
      ['<ada@acme.test>', 'ada@acme.test', undefined],
    ])('%s → from %s, fromName %s', (from, address, name) => {
      const { fields } = map(email({ from }));

      expect(fields.from).toBe(address);
      expect(fields.fromName).toBe(name);
    });
  });

  describe('the headers', () => {
    it('**forwards ONLY `auto-submitted` and `precedence`**, whatever the casing', () => {
      const { fields } = map(
        email({
          headers: {
            'Auto-Submitted': 'auto-replied',
            PRECEDENCE: 'bulk',
            'X-Mailer': 'something the guards never read',
            Received: 'from somewhere',
          },
        }),
      );

      expect(fields.headers).toEqual({
        'auto-submitted': 'auto-replied',
        precedence: 'bulk',
      });
    });

    it('no loop headers → no `headers` key at all', () => {
      expect(map()).not.toHaveProperty('fields.headers');
    });

    it('**`headers: null` degrades rather than throws**', () => {
      const { fields } = map(email({ headers: null }));

      expect(fields.inReplyTo).toBeUndefined();
      expect(fields.references).toEqual([]);
      expect(fields.headers).toBeUndefined();
    });

    it('threading: `In-Reply-To`, `References` split on folded whitespace, `Date`', () => {
      const { fields } = map(
        email({
          headers: {
            'In-Reply-To': ' <a@synapsedesk.test> ',
            References: '<a@synapsedesk.test>\r\n <b@synapsedesk.test>\t<c@x>',
            Date: 'Tue, 15 Sep 2026 10:00:00 +0000',
          },
        }),
      );

      expect(fields.inReplyTo).toBe('<a@synapsedesk.test>');
      expect(fields.references).toEqual([
        '<a@synapsedesk.test>',
        '<b@synapsedesk.test>',
        '<c@x>',
      ]);
      expect(fields.date).toBe('Tue, 15 Sep 2026 10:00:00 +0000');
    });
  });

  describe('identity, body and attachments', () => {
    it('`messageId` is the top-level `message_id`; empty is absent', () => {
      expect(map().fields.messageId).toBe('<m-1@acme.test>');
      expect(map(email({ message_id: '' }))).not.toHaveProperty(
        'fields.messageId',
      );
    });

    it('`receivedAt` is the event’s `created_at`', () => {
      const { fields } = map(email(), {
        ...event(),
        created_at: '2026-09-15T10:00:07.123Z',
      });

      expect(fields.receivedAt).toBe('2026-09-15T10:00:07.123Z');
    });

    it('text and html pass through, null included', () => {
      const { fields } = map(email({ text: null, html: '<p>hi</p>' }));

      expect(fields.text).toBeNull();
      expect(fields.html).toBe('<p>hi</p>');
    });

    it('**attachments are dropped by name; a nameless one is still counted**', () => {
      const attachment = {
        size: 10,
        content_type: 'image/png',
        content_id: null,
        content_disposition: 'attachment',
      };
      const { fields } = map(
        email({
          attachments: [
            { id: 'a-1', filename: 'screenshot.png', ...attachment },
            { id: 'a-2', filename: null, ...attachment },
          ],
        }),
      );

      expect(fields.attachments).toEqual([]);
      expect(fields.droppedAttachments).toEqual([
        'screenshot.png',
        UNNAMED_ATTACHMENT,
      ]);
    });
  });

  describe('against the DTO', () => {
    const errorsOf = async (mail: GetReceivingEmailResponseSuccess) =>
      (
        await validate(
          plainToInstance(InboundEmailDto, map(mail).fields),
          VALIDATION_PIPE_OPTIONS,
        )
      ).map((error) => error.property);

    it('**a well-formed mail passes the same validation the pipe applies**', async () => {
      expect(
        await errorsOf(
          email({
            headers: {
              'In-Reply-To': '<a@x>',
              References: '<a@x> <b@x>',
              'Auto-Submitted': 'no',
            },
          }),
        ),
      ).toEqual([]);
    });

    it('**and an over-long `message_id` from Resend is refused**', async () => {
      // The mapper passes it through untouched; the explicit validation is
      // what stops it before a VarChar(255) unique index does.
      expect(
        await errorsOf(email({ message_id: `<${'a'.repeat(300)}@x>` })),
      ).toEqual(['messageId']);
    });
  });
});
