/**
 * @file The inbound-email webhook, exit by exit.
 *
 * `POST /webhooks/email/resend` has seven exits and each increments
 * `inbound_email_webhook_total{outcome}` exactly once. They are the contract:
 *
 * | Exit | HTTP | `outcome` |
 * | :--- | :--- | :--- |
 * | no raw body *(not reachable from outside — see below)* | 401 | `no_raw_body` |
 * | a missing `svix-*` header, or verification fails | 401 | `rejected_signature` |
 * | a verified event that is not `email.received` | 200 | `ignored_event` |
 * | a retryable fetch error (429, 5xx, no answer) | **503** | `fetch_failed` |
 * | a fetch error a retry will not change (404, 401) | **200** | `fetch_failed` |
 * | the mapped mail fails validation | 200 | `invalid_payload` |
 * | `accept()` ran | 200 | its own outcome |
 *
 * **`no_raw_body` is a configuration failure, not a request a client can make**
 * (a bootstrap without `rawBody: true`): an empty body still reaches the handler
 * as an empty buffer and is rejected as a bad signature, which is what is pinned
 * below. The label exists in the series and is unit-level behaviour, not a row.
 *
 * **The 503/200 split is the safety property.** A retryable failure must be the
 * ONLY non-2xx, because Resend redelivers a non-2xx for about 17 hours and treats
 * a 200 as handled. 200 on a transient failure loses the mail; 503 on a
 * permanent one makes Resend retry for 17 hours before dropping it anyway.
 *
 * **Every row asserts on the CALL LOGS, never on the response alone.** A 503 for
 * the right reason and a 503 because nothing was attempted look identical from
 * outside, and only one is the contract. So each row also asserts what the vendor
 * fake was asked, and which peers were — or were not — called.
 *
 * **And on the counter's delta.** Counters accumulate over a process, so a row
 * reads the series before and after and requires the expected label to rise by
 * exactly one and nothing else to move: "exactly once" is two claims.
 */

import { connect, JSONCodec, type NatsConnection } from 'nats';
import { OrgStatus } from '@synapsedesk/contracts';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { API } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import {
  OWN_ADDRESS,
  RESEND_API_KEY,
  TENANT_TOKEN,
  resendMail,
  tenantAddress,
} from './inbound-mail';
import { rowFor } from './pending';
import { type Peers, startPeers } from './peers';
import { readRunState } from './run-state';
import { signStandardWebhook } from './standard-webhooks';
import { FakeVendor } from './vendor';

describe('the inbound-email webhook', () => {
  const ORGANIZATION = '99999999-9999-4999-8999-999999999999';
  const SENDER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const TICKET = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  let gateway: Gateway;
  let peers: Peers;
  let vendor: FakeVendor;
  let nats: NatsConnection;
  /** What arrived on `email.inbound_rejected` since the last row began. */
  const rejections: Array<Record<string, any>> = [];

  beforeAll(async () => {
    const { redisUrl, natsUrl } = readRunState();
    peers = await startPeers();
    vendor = new FakeVendor('resend');
    await vendor.start();
    // Listening BEFORE the gateway starts: a refusal publishes one event and a
    // late subscriber would never see it.
    nats = await connect({ servers: natsUrl });
    nats.subscribe('email.inbound_rejected', {
      callback: (_error, message) => {
        rejections.push(JSONCodec<Record<string, any>>().decode(message.data));
      },
    });
    await nats.flush();
    gateway = await startGateway({
      ...peers.env,
      REDIS_URL: redisUrl,
      NATS_URL: natsUrl,
      // The stock Resend SDK's own variable — no production code knows it is a fake.
      ...vendor.envFor('RESEND_BASE_URL'),
    });
  }, 90_000);

  afterAll(async () => {
    await gateway.stop();
    await peers.stop();
    await vendor.stop();
    await nats.drain();
  });

  beforeEach(() => {
    peers.reset();
    vendor.reset();
    rejections.length = 0;
  });

  /** Raw `fetch`: these rows sign the EXACT bytes sent. */
  const deliver = async (body: string, headers: Record<string, string>) => {
    const response = await fetch(
      `${gateway.baseUrl}${API}/webhooks/email/resend`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body,
      },
    );
    const text = await response.text();

    return {
      status: response.status,
      body: text ? (JSON.parse(text) as Record<string, any>) : undefined,
    };
  };

  const signed = (body: string) =>
    signStandardWebhook(body, GATEWAY_ENV.RESEND_WEBHOOK_SECRET);

  /** `inbound_email_webhook_total` by `outcome`, as the gateway exports it. */
  const outcomes = async (): Promise<Record<string, number>> => {
    const text = await (await fetch(`${gateway.metricsUrl}/metrics`)).text();
    const counts: Record<string, number> = {};

    for (const line of text.split('\n')) {
      const match = /^inbound_email_webhook_total\{([^}]*)\}\s+(\S+)$/.exec(
        line,
      );
      const outcome = match && /outcome="([^"]*)"/.exec(match[1])?.[1];
      if (match && outcome) counts[outcome] = Number(match[2]);
    }

    return counts;
  };

  /** What rose between two readings of the counter. */
  const risen = (
    before: Record<string, number>,
    after: Record<string, number>,
  ): Record<string, number> =>
    Object.fromEntries(
      Object.entries(after)
        .map(([outcome, count]) => [outcome, count - (before[outcome] ?? 0)])
        .filter(([, increase]) => (increase as number) > 0),
    );

  /**
   * The calls a peer received because of a REQUEST, not because of a scrape.
   *
   * Reading `/metrics` makes the gateway read every peer's job health to build
   * the job gauge, and tags those calls `user_agent: prometheus-scrape`. They
   * arrive after the scrape returns, so they land in whichever window comes
   * next; the tag is what separates them, and a window or a method-name
   * exclusion would only approximate it.
   */
  const caused = (peer: Peers['auth']) =>
    peer
      .calls()
      .filter((call) => call.metadata.user_agent !== 'prometheus-scrape');

  const peerLog = (): string[] =>
    [peers.auth, peers.ticket, peers.ingestion, peers.rag, peers.notification]
      .flatMap(caused)
      .map((call) => call.method);

  /** One delivery, and what it caused: the response, the counter's movement, the peers called. */
  const attempt = async (body: string, headers: Record<string, string>) => {
    const before = await outcomes();
    const response = await deliver(body, headers);

    return {
      response,
      counted: risen(before, await outcomes()),
      peerCalls: peerLog(),
    };
  };

  /** Delivers a mail, correctly signed. */
  const run = (mail: ReturnType<typeof resendMail>) => {
    const body = JSON.stringify(mail.event);

    return attempt(body, signed(body));
  };

  const programMail = (mail: ReturnType<typeof resendMail>) =>
    vendor
      .on('GET', `/emails/receiving/${mail.emailId}`)
      .reply(200, mail.email);

  // ------------------------------------------------------------------ 401s

  describe('a delivery that is not authentic', () => {
    const body = JSON.stringify(resendMail().event);
    const secret = (): string => GATEWAY_ENV.RESEND_WEBHOOK_SECRET;

    rowFor('Webhooks').each([
      ['carries no svix headers at all', () => ({})],
      [
        'is signed with the wrong secret',
        () => signStandardWebhook(body, 'whsec_d3Jvbmctc2VjcmV0'),
      ],
      [
        'is signed for a timestamp ten minutes old',
        () =>
          signStandardWebhook(
            body,
            secret(),
            Math.floor(Date.now() / 1000) - 600,
          ),
      ],
    ])(
      '**401 rejected_signature, and nothing is fetched or called: a delivery that %s**',
      async (_title, headers) => {
        const { response, counted, peerCalls } = await attempt(body, headers());

        expect(response.status).toBe(401);
        expect(counted).toEqual({ rejected_signature: 1 });
        // Nothing unauthenticated causes work: not a fetch, not a peer call.
        expect(vendor.calls()).toEqual([]);
        expect(peerCalls).toEqual([]);
      },
    );

    rowFor('Webhooks')(
      '**an empty body is 401 rejected_signature, and nothing is fetched or called**',
      async () => {
        const { response, counted, peerCalls } = await attempt('', {});

        expect(response.status).toBe(401);
        expect(counted).toEqual({ rejected_signature: 1 });
        expect(vendor.calls()).toEqual([]);
        expect(peerCalls).toEqual([]);
      },
    );
  });

  // ---------------------------------------------------------- ignored events

  rowFor('Webhooks')(
    '**a verified event that is not `email.received` is 200 ignored_event, and nothing is fetched**',
    async () => {
      const mail = resendMail();
      mail.event.type = 'email.delivered';

      const { response, counted, peerCalls } = await run(mail);

      expect(response.status).toBe(200);
      expect(response.body?.data).toEqual({
        received: true,
        outcome: 'ignored_event',
      });
      expect(counted).toEqual({ ignored_event: 1 });
      expect(vendor.calls()).toEqual([]);
      expect(peerCalls).toEqual([]);
    },
  );

  // ------------------------------------------------- the 503 / 200 split

  describe('when fetching the mail fails', () => {
    const fetched = (mail: ReturnType<typeof resendMail>) => {
      const calls = vendor.calls();

      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        method: 'GET',
        path: `/emails/receiving/${mail.emailId}`,
      });
      expect(calls[0].headers.authorization).toBe(`Bearer ${RESEND_API_KEY}`);
    };

    rowFor('Webhooks').each([
      [429, 'rate_limit_exceeded'],
      [500, 'internal_server_error'],
      [503, 'application_error'],
    ])(
      '**a retryable %i is 503 and counted fetch_failed — Resend must redeliver, because a 200 would lose the mail**',
      async (status, name) => {
        const mail = resendMail();
        vendor
          .on('GET', `/emails/receiving/${mail.emailId}`)
          .reply(status, { name, message: 'try again' });

        const { response, counted, peerCalls } = await run(mail);

        expect(response.status).toBe(503);
        expect(counted).toEqual({ fetch_failed: 1 });
        fetched(mail);
        // Routing was never reached: no tenant lookup on a mail never read.
        expect(peerCalls).toEqual([]);
      },
    );

    rowFor('Webhooks')(
      '**no answer at all is 503 and counted fetch_failed — a vendor that never answered says nothing about the mail**',
      async () => {
        const mail = resendMail();
        vendor.on('GET', `/emails/receiving/${mail.emailId}`).dropConnection();

        const { response, counted, peerCalls } = await run(mail);

        expect(response.status).toBe(503);
        expect(counted).toEqual({ fetch_failed: 1 });
        fetched(mail);
        expect(peerCalls).toEqual([]);
      },
    );

    rowFor('Webhooks').each([
      [404, 'not_found'],
      [401, 'restricted_api_key'],
    ])(
      '**a permanent %i is 200 and counted fetch_failed — a retry fails identically, so 503 would only make Resend retry for 17 hours**',
      async (status, name) => {
        const mail = resendMail();
        vendor
          .on('GET', `/emails/receiving/${mail.emailId}`)
          .reply(status, { name, message: 'no' });

        const { response, counted, peerCalls } = await run(mail);

        expect(response.status).toBe(200);
        expect(response.body?.data).toEqual({
          received: true,
          outcome: 'fetch_failed',
        });
        expect(counted).toEqual({ fetch_failed: 1 });
        fetched(mail);
        expect(peerCalls).toEqual([]);
      },
    );
  });

  // ------------------------------------------------------- invalid payload

  rowFor('Webhooks')(
    '**a mail whose sender is not an address is 200 invalid_payload — nothing is routed**',
    async () => {
      const mail = resendMail({ from: 'not an address' });
      programMail(mail);

      const { response, counted, peerCalls } = await run(mail);

      expect(response.status).toBe(200);
      expect(response.body?.data).toEqual({
        received: true,
        outcome: 'invalid_payload',
      });
      expect(counted).toEqual({ invalid_payload: 1 });
      expect(vendor.calls()).toHaveLength(1);
      expect(peerCalls).toEqual([]);
    },
  );

  // ------------------------------------------------------ accept() ran

  describe('when the mail reaches accept()', () => {
    const resolveOrganization = (status: OrgStatus = OrgStatus.ACTIVE) =>
      peers.auth.on('OrganizationService/ResolveOrgByInboundToken').reply({
        organizationId: ORGANIZATION,
        status: toProtoOrgStatus(status),
        maxAttachmentBytes: 10_000_000,
      });

    /** Delivers a programmed mail and asserts the shared shape of every accept() exit. */
    const accepted = async (
      mail: ReturnType<typeof resendMail>,
      outcome: string,
    ) => {
      programMail(mail);

      const { response, counted, peerCalls } = await run(mail);

      expect(response.status).toBe(200);
      expect(response.body?.data).toEqual({ received: true, outcome });
      expect(counted).toEqual({ [outcome]: 1 });
      // The mail was fetched once; no attachment list was spent on it.
      expect(vendor.calls()).toHaveLength(1);

      return { peerCalls };
    };

    rowFor('Webhooks')(
      '**mail from our own address is SELF_ADDRESSED, before any peer is called — replying to ourselves is the loop**',
      async () => {
        const { peerCalls } = await accepted(
          resendMail({ from: OWN_ADDRESS }),
          'SELF_ADDRESSED',
        );

        expect(peerCalls).toEqual([]);
      },
    );

    rowFor('Webhooks')(
      '**an address that is not a tenant address is UNROUTABLE_ADDRESS, with no tenant lookup**',
      async () => {
        const { peerCalls } = await accepted(
          resendMail({ to: `support@${tenantAddress().split('@')[1]}` }),
          'UNROUTABLE_ADDRESS',
        );

        expect(peerCalls).toEqual([]);
      },
    );

    rowFor('Webhooks')(
      '**a token no tenant owns is UNROUTABLE_ADDRESS, after exactly one lookup by that token**',
      async () => {
        peers.auth.on('OrganizationService/ResolveOrgByInboundToken').reply({});

        const { peerCalls } = await accepted(
          resendMail(),
          'UNROUTABLE_ADDRESS',
        );

        const lookups = peers.auth.calls(
          'OrganizationService/ResolveOrgByInboundToken',
        );
        expect(lookups).toHaveLength(1);
        expect(lookups[0].request).toMatchObject({
          inboundToken: TENANT_TOKEN,
        });
        expect(peerCalls).toEqual([
          'OrganizationService/ResolveOrgByInboundToken',
        ]);
      },
    );

    rowFor('Webhooks')(
      '**a tenant that is not active is TENANT_INACTIVE, and its sender is never resolved**',
      async () => {
        resolveOrganization(OrgStatus.FROZEN);

        const { peerCalls } = await accepted(resendMail(), 'TENANT_INACTIVE');

        expect(peerCalls).toEqual([
          'OrganizationService/ResolveOrgByInboundToken',
        ]);
      },
    );

    rowFor('Webhooks')(
      '**a sender the tenant does not admit is SENDER_NOT_PERMITTED, and no ticket is created**',
      async () => {
        resolveOrganization();
        peers.auth.on('UserService/ResolveInboundSender').reply({});

        await accepted(resendMail(), 'SENDER_NOT_PERMITTED');

        expect(caused(peers.ticket)).toEqual([]);
      },
    );

    const createsTicketFor = (mail: ReturnType<typeof resendMail>) => {
      resolveOrganization();
      peers.auth
        .on('UserService/ResolveInboundSender')
        .reply({ userId: SENDER, created: false });
      peers.ticket.on('TicketService/CreateTicket').reply({
        ticket: { id: TICKET, ticketNumber: 1 },
        skippedAttachments: [],
      });
      programMail(mail);
    };

    rowFor('Webhooks')(
      '**a body over the cap is shortened and the ticket says so — the rest of the mail is not lost, and a reader is not misled**',
      async () => {
        const mail = resendMail({ text: 'x'.repeat(120_000) });
        createsTicketFor(mail);

        const { response } = await run(mail);

        expect(response.status).toBe(200);
        expect(response.body?.data.outcome).toBe('TICKET_CREATED');
        const note =
          '\n\n---\nThis message was longer than 50000 characters and has been shortened.';
        const { description } = peers.ticket.calls(
          'TicketService/CreateTicket',
        )[0].request as { description: string };
        expect(description).toBe('x'.repeat(50_000) + note);
      },
    );

    rowFor('Webhooks')(
      '**a hostile body of unclosed tags is answered promptly — the patterns that read it are quadratic, and uncapped this is minutes of a request thread**',
      async () => {
        const mail = resendMail({
          text: null,
          html: '<p>' + '<div '.repeat(120_000),
        });
        createsTicketFor(mail);

        const started = Date.now();
        const { response } = await run(mail);

        expect(response.status).toBe(200);
        expect(response.body?.data.outcome).toBe('TICKET_CREATED');
        // About 0.5 s at the cap; uncapped it is ~35 s here. A bound on the ORDER, not a benchmark.

        expect(Date.now() - started).toBeLessThan(30_000);
      },
      60_000,
    );

    /** Waits for the publish, which is fire-and-forget and lands after the response. */
    const published = async (count: number) => {
      const deadline = Date.now() + 4_000;
      while (rejections.length < count && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      // A little longer, so a second event that should NOT exist has time to.
      await new Promise((resolve) => setTimeout(resolve, 300));

      return [...rejections];
    };

    rowFor('Webhooks')(
      '**a refused sender is told once: SENDER_NOT_PERMITTED publishes one `email.inbound_rejected`, for that tenant and that sender**',
      async () => {
        resolveOrganization();
        peers.auth.on('UserService/ResolveInboundSender').reply({});

        await accepted(resendMail(), 'SENDER_NOT_PERMITTED');

        const events = await published(1);
        expect(events).toHaveLength(1);
        // Nest's `emit` envelope, which notification-service unwraps.
        expect(Object.keys(events[0]).sort()).toEqual(['data', 'pattern']);
        expect(events[0].pattern).toBe('email.inbound_rejected');
        expect(events[0].data).toMatchObject({
          pattern: 'email.inbound_rejected',
          organizationId: ORGANIZATION,
          sender: 'customer@acme.test',
          reason: 'SENDER_NOT_PERMITTED',
        });
        const occurredAt = events[0].data.occurredAt as string;
        expect(new Date(occurredAt).toISOString()).toBe(occurredAt);
      },
    );

    rowFor('Webhooks')(
      '**a tenant that is not active publishes the refusal as UNROUTABLE — the reason the reply template never reveals**',
      async () => {
        resolveOrganization(OrgStatus.FROZEN);

        await accepted(resendMail(), 'TENANT_INACTIVE');

        const events = await published(1);
        expect(events).toHaveLength(1);
        expect(events[0].data).toMatchObject({
          organizationId: ORGANIZATION,
          sender: 'customer@acme.test',
          reason: 'UNROUTABLE',
        });
      },
    );

    rowFor('Webhooks')(
      '**a token no tenant owns publishes NOTHING — replying to an unverified sender would make this domain a backscatter source**',
      async () => {
        peers.auth.on('OrganizationService/ResolveOrgByInboundToken').reply({});

        await accepted(resendMail(), 'UNROUTABLE_ADDRESS');

        expect(await published(1)).toEqual([]);
      },
    );

    rowFor('Webhooks')(
      '**a machine-generated mail is refused without a reply — an auto-responder on the other end would make an exchange with no upper bound**',
      async () => {
        resolveOrganization();
        peers.auth.on('UserService/ResolveInboundSender').reply({});

        await accepted(
          resendMail({ headers: { 'Auto-Submitted': 'auto-replied' } }),
          'SENDER_NOT_PERMITTED',
        );

        expect(await published(1)).toEqual([]);
      },
    );

    rowFor('Webhooks')(
      '**a mail from an admitted sender creates a ticket as TICKET_CREATED, authored by that sender and keyed by the mail’s own Message-ID**',
      async () => {
        const mail = resendMail({ subject: '  The printer is on fire  ' });
        resolveOrganization();
        peers.auth
          .on('UserService/ResolveInboundSender')
          .reply({ userId: SENDER, created: false });
        peers.ticket.on('TicketService/CreateTicket').reply({
          ticket: { id: TICKET, ticketNumber: 1 },
          skippedAttachments: [],
        });

        await accepted(mail, 'TICKET_CREATED');

        const created = peers.ticket.calls('TicketService/CreateTicket');
        expect(created).toHaveLength(1);
        expect(created[0].request).toMatchObject({
          title: 'The printer is on fire',
          description: 'It really is. Please help.',
          authorId: SENDER,
          inboundMessageId: mail.messageId,
        });
        // The sender was resolved for THIS tenant, from the address's token.
        expect(
          peers.auth.calls('UserService/ResolveInboundSender')[0].request,
        ).toMatchObject({
          organizationId: ORGANIZATION,
          email: 'customer@acme.test',
        });
      },
    );
  });
});
