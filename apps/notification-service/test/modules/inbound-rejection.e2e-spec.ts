import { faker } from '@faker-js/faker';
import {
  EMAIL_INBOUND_PATTERNS,
  EmailTemplateName,
  InboundRejectionReason,
  type InboundEmailRejectedEvent,
} from '@synapsedesk/common';
import { bootstrapE2eTest, E2eFixture } from '../utils/bootstrap';
import { EmailService } from '../../src/modules/email/email.service';
import { InboundRejectionConsumer } from '../../src/modules/inbound-email/inbound-rejection.consumer';

/**
 * The reply to mail the gateway refused
 *
 * **The rate limit lives here because the sending does.** A limit enforced by
 * the publisher counts intentions; enforced by the sender it counts messages,
 * and a mail loop is made of messages.
 */
describe('§32 §5 inbound rejection auto-reply (e2e)', () => {
  let fx: E2eFixture;
  let consumer: InboundRejectionConsumer;
  let send: jest.SpyInstance;

  const ORG = faker.string.uuid();

  const event = (
    sender: string,
    reason = InboundRejectionReason.SENDER_NOT_PERMITTED,
    organizationId: string | null = ORG,
  ): InboundEmailRejectedEvent => ({
    pattern: EMAIL_INBOUND_PATTERNS.rejected,
    organizationId,
    sender,
    reason,
    occurredAt: new Date().toISOString(),
  });

  /** The handler is fire-and-forget, so a test has to wait for its tail. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    consumer = fx.moduleRef.get(InboundRejectionConsumer);
  }, 30_000);

  beforeEach(async () => {
    await fx.reset();
    send = jest
      .spyOn(fx.moduleRef.get(EmailService), 'send')
      .mockResolvedValue({ messageId: '<sent@test>' });
  });

  afterEach(() => send.mockRestore());

  afterAll(() => fx.close());

  it('1. a refused sender is told once', async () => {
    consumer.rejected(event('stranger@acme.test'));
    await settle();

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({
      template: EmailTemplateName.INBOUND_REJECTED,
      to: 'stranger@acme.test',
    });
  });

  it('4. **two rejections from one address in a day send ONE reply**', async () => {
    // The loop guard. The thing most likely to be behind a refused address is
    // an auto-responder, and a reply per message is the exchange with no bound.
    consumer.rejected(event('stranger@acme.test'));
    await settle();
    consumer.rejected(event('stranger@acme.test'));
    await settle();

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('**and a burst arriving at once still sends one**', async () => {
    // Read-then-write would let every copy of one auto-responder's message
    // observe "nobody has replied today" and all reply. The claim is a
    // conditional UPDATE plus a unique INSERT, so exactly one wins.
    for (let i = 0; i < 5; i++) consumer.rejected(event('burst@acme.test'));
    await settle();
    await settle();

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('but a DIFFERENT address is told independently', async () => {
    consumer.rejected(event('one@acme.test'));
    await settle();
    consumer.rejected(event('two@acme.test'));
    await settle();

    expect(send).toHaveBeenCalledTimes(2);
  });

  it('and the address is matched case-insensitively', async () => {
    // Otherwise `Stranger@` and `stranger@` are two correspondents, and the
    // limit is one reply per spelling.
    consumer.rejected(event('Stranger@Acme.test'));
    await settle();
    consumer.rejected(event('stranger@acme.test'));
    await settle();

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('**a yesterday’s reply does not suppress today’s**', async () => {
    consumer.rejected(event('stranger@acme.test'));
    await settle();

    await fx.prisma.inboundAutoReply.updateMany({
      where: { email: 'stranger@acme.test' },
      data: { lastSentAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });

    consumer.rejected(event('stranger@acme.test'));
    await settle();

    expect(send).toHaveBeenCalledTimes(2);
  });

  it('**and a send failure does not kill the consumer**', async () => {
    // An unhandled rejection in a NATS handler takes the process down, and the
    // worst case here is one courtesy reply nobody receives.
    send.mockRejectedValueOnce(new Error('SMTP is down'));

    expect(() => consumer.rejected(event('stranger@acme.test'))).not.toThrow();
    await settle();

    // Still alive, still answering.
    consumer.rejected(event('another@acme.test'));
    await settle();

    expect(send).toHaveBeenCalledTimes(2);
  });

  it('an event with no sender is logged, not thrown', () => {
    expect(() => consumer.rejected({ ...event(''), sender: '' })).not.toThrow();
  });

  it('**and one with no tenant sends nothing** — that path is backscatter', async () => {
    // An address that resolved to no tenant no longer produces a reply at all:
    // `from` is unauthenticated, SMTP `From` is trivially forged, and replying
    // would mail a victim on an attacker's behalf. This is the consumer's half
    // of that guard.
    consumer.rejected(event('stranger@acme.test', undefined, null));
    await settle();

    expect(send).not.toHaveBeenCalled();
  });

  it('**a sender writing to TWO tenants is told by both**', async () => {
    // Keyed `(organization_id, email)`. Globally keyed, the second tenant's
    // reply is silently suppressed and the sender concludes that tenant's
    // support address is dead.
    consumer.rejected(event('stranger@acme.test', undefined, ORG));
    await settle();
    consumer.rejected(
      event('stranger@acme.test', undefined, faker.string.uuid()),
    );
    await settle();

    expect(send).toHaveBeenCalledTimes(2);
  });
});
