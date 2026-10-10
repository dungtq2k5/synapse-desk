import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import type { ErrorResponse } from 'resend';
import {
  EmailTemplateName,
  UnprocessableMessage,
  type SendEmailCommand,
} from '@synapsedesk/common';
import { EmailService, idempotencyKeyFor, messageIdFor } from './email.service';

const send = jest.fn();

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send } })),
}));

/**
 * The Resend adapter, against a mocked SDK.
 *
 * Every e2e suite spies `EmailService.send` itself, so this file is the only
 * place the real method runs: the idempotency key, the `Message-ID` it derives,
 * and the error classification the JetStream consumer relies on are pinned
 * here or nowhere.
 */
describe('EmailService (Resend)', () => {
  const env: Record<string, string> = {
    EMAIL_SENDER: '"SynapseDesk" <noreply@synapsedesk.test>',
    APP_NAME: 'SynapseDesk',
    APP_WEB_URL: 'https://app.synapsedesk.test',
    SUPPORT_EMAIL: 'support@synapsedesk.test',
    RESEND_API_KEY: 're_test_placeholder',
  };

  const build = () => {
    const service = new EmailService({
      getOrThrow: (key: string) => env[key],
    } as unknown as ConfigService);
    service.onModuleInit();

    return service;
  };

  const command: SendEmailCommand = {
    sendId: '1f534452-8ae0-4367-bae9-2e4feafb73e7',
    template: EmailTemplateName.WELCOME,
    to: 'ada@acme.test',
    data: {
      fullName: 'Ada',
      organizationName: null,
      origin: { ip: '203.0.113.7', userAgent: 'jest' },
    },
  };

  const error = (overrides: Partial<ErrorResponse>): ErrorResponse => ({
    name: 'application_error',
    statusCode: 500,
    message: 'boom',
    ...overrides,
  });

  beforeEach(() => {
    send.mockReset();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  describe('a successful send', () => {
    beforeEach(() =>
      send.mockResolvedValue({ data: { id: 'resend-1' }, error: null }),
    );

    it('**returns OUR `Message-ID`, never Resend’s `data.id`**', async () => {
      // The inbound `In-Reply-To` fallback matches this against what a
      // customer's client echoes back, and a client only ever echoes the RFC
      // header. Storing `data.id` would make every token-less reply a new ticket.
      const { messageId } = await build().send(command);

      expect(messageId).not.toBe('resend-1');
      expect(messageId).toMatch(/^<[0-9a-f]{64}@synapsedesk\.test>$/);
    });

    it('sends that same `Message-ID` as a header, under the idempotency key', async () => {
      const { messageId } = await build().send(command);

      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          from: env.EMAIL_SENDER,
          to: 'ada@acme.test',
          headers: { 'Message-ID': messageId },
        }),
        { idempotencyKey: `WELCOME/${command.sendId}` },
      );
    });

    it('**a redelivery sends a BYTE-IDENTICAL request**', async () => {
      // The provider compares bodies under a key: a header that changed between
      // two deliveries of one command would be answered 409 on exactly the
      // retry the key exists for.
      const service = build();

      await service.send(command);
      await service.send(command);

      expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
    });

    it('**two sends of one command to two recipients use two keys**', async () => {
      // The in-app fan-out: one event, several people. A shared key would have
      // the provider refuse every recipient after the first.
      const service = build();

      await service.send(command, { recipientUserId: 'user-a' });
      await service.send(command, { recipientUserId: 'user-b' });

      const keys = send.mock.calls.map(([, options]) => options.idempotencyKey);
      const headers = send.mock.calls.map(
        ([body]) => body.headers['Message-ID'],
      );
      expect(keys).toEqual([
        `WELCOME/${command.sendId}/user-a`,
        `WELCOME/${command.sendId}/user-b`,
      ]);
      expect(headers[0]).not.toBe(headers[1]);
    });

    it('two ACTS with identical content are two sends', async () => {
      // A content hash would collapse these, and the provider would answer the
      // second security alert with the first one's result and send nothing.
      const service = build();

      await service.send(command);
      await service.send({ ...command, sendId: 'a-different-act' });

      expect(send.mock.calls[0][1]).not.toEqual(send.mock.calls[1][1]);
    });

    it('sets `replyTo` only when one is given', async () => {
      const service = build();

      await service.send(command);
      await service.send(command, { replyTo: 'support+abc@inbound.test' });

      expect(send.mock.calls[0][0]).not.toHaveProperty('replyTo');
      expect(send.mock.calls[1][0]).toHaveProperty(
        'replyTo',
        'support+abc@inbound.test',
      );
    });
  });

  describe('a failed send is CLASSIFIED for the consumer', () => {
    const outcome = async (response: ErrorResponse) => {
      send.mockResolvedValue({ data: null, error: response });

      return build()
        .send(command)
        .then(
          () => 'resolved',
          (thrown: unknown) =>
            thrown instanceof UnprocessableMessage ? 'park' : 'retry',
        );
    };

    it.each([
      [
        '500 internal_server_error',
        { name: 'internal_server_error', statusCode: 500 },
      ],
      [
        '503 application_error (a non-JSON body)',
        { name: 'application_error', statusCode: 503 },
      ],
      [
        '429 rate_limit_exceeded',
        { name: 'rate_limit_exceeded', statusCode: 429 },
      ],
      [
        'null-status application_error — the fetch failure',
        { name: 'application_error', statusCode: null },
      ],
      [
        '409 concurrent_idempotent_requests',
        { name: 'concurrent_idempotent_requests', statusCode: 409 },
      ],
    ] as const)(
      '%s → a plain throw, so JetStream redelivers',
      async (_, response) => {
        expect(await outcome(error(response))).toBe('retry');
      },
    );

    it.each([
      ['422 validation_error', { name: 'validation_error', statusCode: 422 }],
      [
        '403 application_error (a proxy page)',
        { name: 'application_error', statusCode: 403 },
      ],
      [
        '401 restricted_api_key',
        { name: 'restricted_api_key', statusCode: 401 },
      ],
      [
        '409 invalid_idempotent_request',
        { name: 'invalid_idempotent_request', statusCode: 409 },
      ],
      [
        'null-status missing_required_field — an SDK argument check',
        { name: 'missing_required_field', statusCode: null },
      ],
    ] as const)(
      '%s → UnprocessableMessage, so the consumer parks it',
      async (_, response) => {
        // A plain throw here would redeliver a request that fails identically
        // until the retry budget runs out; not throwing would ack and lose it.
        expect(await outcome(error(response))).toBe('park');
      },
    );
  });

  describe('the pure parts', () => {
    it('the key is template/sendId, plus the recipient on a fan-out', () => {
      expect(idempotencyKeyFor(command)).toBe(`WELCOME/${command.sendId}`);
      expect(idempotencyKeyFor(command, 'u-1')).toBe(
        `WELCOME/${command.sendId}/u-1`,
      );
    });

    it('**a send id with `:` still yields a valid `Message-ID`**', () => {
      // Event ids are `dunning:evt_1` or carry an ISO timestamp, and `:` is not
      // allowed in a Message-ID's left-hand side. Spelled out, the key would
      // produce a header a strict MTA refuses.
      const id = messageIdFor(
        idempotencyKeyFor(
          {
            template: EmailTemplateName.PAYMENT_FAILED,
            sendId: 'dunning:evt_1',
          },
          'u-1',
        ),
        'synapsedesk.test',
      );

      expect(id).toMatch(/^<[0-9a-f]{64}@synapsedesk\.test>$/);
      expect(id).toBe(
        messageIdFor('PAYMENT_FAILED/dunning:evt_1/u-1', 'synapsedesk.test'),
      );
    });
  });
});
