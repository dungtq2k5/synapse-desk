import { of } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import {
  ORGANIZATION_SERVICE_NAME,
  OrgStatus as ProtoOrgStatus,
  USER_SERVICE_NAME,
} from '@synapsedesk/grpc-proto';
import {
  InboundRejectionReason,
  buildInboundAddress,
  generateInboundToken,
} from '@synapsedesk/common';
import { InboundEmailService, InboundOutcome } from './inbound-email.service';
import type { InboundEmailPublisher } from './inbound-email.publisher';
import type { InboundEmailDto } from './dto/rest/inbound-email.dto';

/**
 * Mail-loop guards
 *
 * **The failure these prevent reaches somebody else's inbox**, which is why
 * they ship with the routing rather than after it. An auto-responder on the
 * other end of a refused address plus a courtesy reply from us is an exchange
 * with no upper bound, and every message in it is real mail somebody receives.
 */
describe('inbound email loop guards', () => {
  const EMAIL_SENDER = 'support@synapsedesk.test';

  const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
  const KNOWN_ADDRESS = buildInboundAddress(
    'inbound.test',
    generateInboundToken(),
  );

  let rejected: jest.Mock;
  let service: InboundEmailService;

  /**
   * Addressed to a REAL tenant whose sender is refused.
   *
   * The reply is only ever sent when a tenant is known — mailing an
   * unauthenticated `From` on behalf of an address that resolved to nobody is
   * backscatter. So a payload aimed at nowhere can no longer tell a suppressed
   * reply from an absent one, and every test about the loop guards has to start
   * from a tenant that exists.
   */
  const payload = (
    overrides: Partial<InboundEmailDto> = {},
  ): InboundEmailDto => ({
    to: KNOWN_ADDRESS,
    from: 'customer@acme.test',
    subject: 'Help',
    text: 'Please help',
    html: null,
    receivedAt: new Date().toISOString(),
    ...overrides,
  });

  beforeEach(() => {
    rejected = jest.fn();

    const config = {
      getOrThrow: (key: string) =>
        key === 'EMAIL_SENDER' ? EMAIL_SENDER : 'secret',
    } as unknown as ConfigService;

    const auth = {
      getService: (name: string) =>
        name === ORGANIZATION_SERVICE_NAME
          ? {
              resolveOrgByInboundToken: () =>
                of({
                  organizationId: ORGANIZATION_ID,
                  status: ProtoOrgStatus.ORG_STATUS_ACTIVE,
                }),
            }
          : name === USER_SERVICE_NAME
            ? {
                // Refused: a stranger's domain is not permitted here, which is
                // the one drop that legitimately answers the sender.
                resolveInboundSender: () =>
                  of({ userId: undefined, created: false }),
              }
            : {},
    };

    service = new InboundEmailService(
      auth as never,
      { getService: () => ({}) } as never,
      { getService: () => ({}) } as never,
      config,
      { rejected } as unknown as InboundEmailPublisher,
    );
    service.onModuleInit();
  });

  describe('2. the self-loop', () => {
    it('**mail from our own address is ignored entirely**', async () => {
      // Not merely "no auto-reply" — no processing at all. Our notification
      // bouncing back is the loop, and the only safe response is silence.
      await expect(
        service.accept(payload({ from: EMAIL_SENDER })),
      ).resolves.toBe(InboundOutcome.SELF_LOOP);

      expect(rejected).not.toHaveBeenCalled();
    });

    it('**and recognises it inside a display name**', async () => {
      // `From: "SynapseDesk Support" <support@…>` is the same sender. Comparing
      // the whole header would miss it and fail OPEN into the loop.
      await expect(
        service.accept(
          payload({ from: `"SynapseDesk Support" <${EMAIL_SENDER}>` }),
        ),
      ).resolves.toBe(InboundOutcome.SELF_LOOP);
    });

    it('and is case-insensitive, as addresses are', async () => {
      await expect(
        service.accept(payload({ from: EMAIL_SENDER.toUpperCase() })),
      ).resolves.toBe(InboundOutcome.SELF_LOOP);
    });
  });

  describe('1. never auto-reply to an auto-reply', () => {
    it.each([
      ['Auto-Submitted: auto-replied', { 'auto-submitted': 'auto-replied' }],
      [
        'Auto-Submitted: auto-generated',
        { 'auto-submitted': 'auto-generated' },
      ],
      ['Precedence: bulk', { precedence: 'bulk' }],
      ['Precedence: list', { precedence: 'list' }],
      ['Precedence: junk', { precedence: 'junk' }],
      ['a header in mixed case', { 'Auto-Submitted': 'AUTO-REPLIED' }],
    ])('%s publishes no rejection event', async (_, headers) => {
      const outcome = await service.accept(payload({ headers }));

      // The mail is still dropped and still logged — what is suppressed is the
      // reply, which is the half that can loop.
      expect(outcome).toBe(InboundOutcome.SENDER_REFUSED);
      expect(rejected).not.toHaveBeenCalled();
    });

    it('**but `Auto-Submitted: no` is a human, and still gets a reply**', async () => {
      // The value RFC 3834 defines for ordinary mail. Treating any presence of
      // the header as automated would silence the reply for clients that set it
      // conscientiously — the over-blocking direction, where a real person is
      // left with silence.
      await service.accept(payload({ headers: { 'auto-submitted': 'no' } }));

      expect(rejected).toHaveBeenCalledTimes(1);
    });
  });

  describe('the drop is visible to the sender', () => {
    it('a refused sender in a KNOWN tenant publishes one rejection', async () => {
      await service.accept(payload());

      expect(rejected).toHaveBeenCalledWith({
        organizationId: ORGANIZATION_ID,
        sender: 'customer@acme.test',
        reason: InboundRejectionReason.SENDER_NOT_PERMITTED,
      });
    });

    it('**but an address that resolved to no tenant publishes nothing**', async () => {
      // `from` is unauthenticated and SMTP `From` is trivially forged, so a
      // reply to an address nobody owns mails a stranger on the sender's
      // behalf. Silence is the only safe answer, even though it is the case
      // where a legitimate sender would most want telling.
      const outcome = await service.accept(
        payload({ to: 'support+nobody@inbound.test' }),
      );

      expect(outcome).toBe(InboundOutcome.UNROUTABLE);
      expect(rejected).not.toHaveBeenCalled();
    });
  });
});
