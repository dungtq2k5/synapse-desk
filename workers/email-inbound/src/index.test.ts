import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import handler from './index.ts';

/**
 * The Worker's response handling — the one branch that decides whether a
 * misconfiguration becomes a retry storm.
 *
 * **`node --test`, and no test dependency at all.** Node 24 strips TypeScript
 * natively, so this needs no vitest, no jest and no install inside a package
 * that is deliberately outside the workspaces. That mattered to whether this
 * test existed: the alternative was shipping the control-flow change with
 * nothing asserting it, which is how the defect it fixes was born — a comment
 * claiming "reported and not retried" above a branch that threw.
 *
 * **`worker-contract.spec.ts` cannot cover this and is not meant to.** That one
 * lives on the gateway side and validates recorded payloads against
 * `InboundEmailDto`; it never executes `email()`, so it sees shape and never
 * control flow.
 */
describe('the mail Worker’s response handling', () => {
  const ENV = {
    WEBHOOK_URL: 'https://gateway.test/api/v1/webhooks/email/inbound',
    ATTACHMENTS_URL: 'https://gateway.test/api/v1/webhooks/email/attachments',
    INBOUND_SECRET: 'a-shared-secret',
  };

  const RAW = [
    'From: customer@acme.test',
    'To: support+tenant@inbound.test',
    'Message-ID: <one@acme.test>',
    'Date: Thu, 5 Sep 2026 10:00:00 +0000',
    'Subject: Help',
    'Content-Type: text/plain',
    '',
    'My printer is on fire.',
  ].join('\r\n');

  /** The fields `email()` reads, and nothing else. */
  const message = () => ({
    raw: RAW,
    to: 'support+tenant@inbound.test',
    from: 'customer@acme.test',
    headers: new Headers({ date: 'Thu, 5 Sep 2026 10:00:00 +0000' }),
  });

  const realFetch = globalThis.fetch;
  let statuses: number[] = [];

  const respondWith = (status: number) => {
    statuses = [];
    globalThis.fetch = ((..._args: unknown[]) => {
      statuses.push(status);

      return Promise.resolve(new Response('', { status }));
    }) as typeof fetch;
  };

  beforeEach(() => {
    statuses = [];
  });

  after(() => {
    globalThis.fetch = realFetch;
  });

  it('a 401 RESOLVES — the message is dropped, not retried', async () => {
    // The fix. An uncaught throw out of `email()` is what makes Cloudflare
    // retry, so resolving is the only way to stop a wrong `INBOUND_SECRET`
    // producing an unbounded retry of every inbound message.
    respondWith(401);

    await assert.doesNotReject(handler.email(message() as never, ENV as never));
    assert.equal(statuses.length, 1, 'the webhook was called exactly once');
  });

  it('a 500 still REJECTS — the 401 is special, not swallowed', async () => {
    // The control, and without it the test above passes for a handler that
    // swallows everything. A transient gateway failure must still retry: the
    // gateway's `(organization_id, message_id)` dedup is what makes that safe.
    respondWith(500);

    await assert.rejects(handler.email(message() as never, ENV as never));
  });

  it('a 2xx resolves and calls the webhook once', async () => {
    respondWith(200);

    await assert.doesNotReject(handler.email(message() as never, ENV as never));
    assert.equal(statuses.length, 1);
  });
});
